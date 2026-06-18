import { z } from 'zod';

/**
 * Password policy (CLAUDE.md §3.13). Minimum 12 characters (modern NIST-style length-first
 * guidance); maximum 128 because Argon2id hashes the entire input — an unbounded password is
 * a CPU/memory denial-of-service vector. All-whitespace is rejected.
 *
 * The value object is the policy: validation lives here, hashing lives in the infrastructure
 * `PasswordHasher` adapter, so the domain has no crypto/framework dependency.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => value.trim().length > 0, 'Password must not be blank');

export type Password = z.infer<typeof passwordSchema>;
