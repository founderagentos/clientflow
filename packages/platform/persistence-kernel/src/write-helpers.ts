import { OptimisticLockError } from '@agentos/result-errors';

/** Next version value for an optimistic-lock write (§3.4). */
export function nextVersion(current: number): number {
  return current + 1;
}

/**
 * Assert that a version-guarded UPDATE matched a row. A zero row count means the row was
 * concurrently modified (or soft-deleted) — surface as 409 (§3.4).
 */
export function assertVersionMatched(affectedRows: number): void {
  if (affectedRows === 0) {
    throw new OptimisticLockError();
  }
}

export interface SoftDeletePatch {
  deletedAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Field patch for a soft delete (§3.4 — never physically delete tenant rows). */
export function softDeletePatch(actorPrincipalId: string | null): SoftDeletePatch {
  const now = new Date();
  return { deletedAt: now, updatedAt: now, updatedBy: actorPrincipalId };
}
