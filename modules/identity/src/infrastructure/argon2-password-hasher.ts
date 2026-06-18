import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IDENTITY_AUTH_CONFIG, type IdentityAuthConfig } from './identity-auth.config';

/**
 * Port for password hashing (CLAUDE.md §3.13 — Argon2id only, never custom crypto). An
 * abstract class doubles as the DI token so the algorithm is swappable and the login path can
 * depend on the interface, not the implementation.
 */
export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract verify(hash: string, plain: string): Promise<boolean>;
  /**
   * Verify against a precomputed throwaway hash. Login calls this when no identity exists so
   * the request still spends one Argon2 verify — equalizing response time and defeating user
   * enumeration via timing.
   */
  abstract verifyAgainstDummy(plain: string): Promise<void>;
}

@Injectable()
export class Argon2PasswordHasher extends PasswordHasher implements OnModuleInit {
  private readonly options: argon2.Options;
  private dummyHash = '';

  constructor(@Inject(IDENTITY_AUTH_CONFIG) config: IdentityAuthConfig) {
    super();
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.argon2.memoryKib,
      timeCost: config.argon2.timeCost,
      parallelism: config.argon2.parallelism,
    };
  }

  async onModuleInit(): Promise<void> {
    // Precompute once at boot using the live params so dummy-verify timing matches real verify.
    this.dummyHash = await argon2.hash('argon2id-timing-equalizer-placeholder', this.options);
  }

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed/missing hash → treat as a failed verification, never throw to the caller.
      return false;
    }
  }

  async verifyAgainstDummy(plain: string): Promise<void> {
    await this.verify(this.dummyHash, plain);
  }
}
