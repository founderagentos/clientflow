import { Injectable } from '@nestjs/common';
import { ConflictError } from '@agentos/result-errors';
import type { Tx } from '@agentos/persistence-kernel';
import { PrincipalsRepository } from '../infrastructure/principals.repository';
import { UsersRepository } from '../infrastructure/users.repository';
import { IdentitiesRepository } from '../infrastructure/identities.repository';

export interface RegisterUserInput {
  principalId: string;
  email: string;
  displayName: string;
  /** Argon2id hash, computed by the caller BEFORE the transaction (keeps the slow KDF off the
   * open transaction / connection). */
  passwordHash: string;
}

export interface RegisteredUser {
  principalId: string;
  userId: string;
  identityId: string;
  email: string;
}

/**
 * Creates the identity-side rows of a new account — principal (actor supertype), user (global
 * person), and a password identity — inside the caller's transaction (CLAUDE.md §3.2/§3.3).
 * Public service: the host registration orchestrator composes this with the organization /
 * workspace / access provisioners into one atomic unit of work (§17).
 */
@Injectable()
export class UserRegistrar {
  constructor(
    private readonly principals: PrincipalsRepository,
    private readonly users: UsersRepository,
    private readonly identities: IdentitiesRepository,
  ) {}

  async create(tx: Tx, input: RegisterUserInput): Promise<RegisteredUser> {
    const email = input.email.trim().toLowerCase();

    // Clean 409 ahead of the unique index (users_primary_email_key) — which remains the hard
    // guarantee under concurrency.
    if (await this.users.existsByEmail(email, tx)) {
      throw new ConflictError('An account with this email already exists');
    }

    await this.principals.insertUserPrincipal(tx, input.principalId);
    await this.users.insert(tx, {
      id: input.principalId,
      primaryEmail: email,
      displayName: input.displayName,
    });
    const identityId = await this.identities.insertPassword(tx, {
      userId: input.principalId,
      providerSubject: email,
      secretHash: input.passwordHash,
    });

    return { principalId: input.principalId, userId: input.principalId, identityId, email };
  }
}
