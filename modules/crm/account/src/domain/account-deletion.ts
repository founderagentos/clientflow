import { ConflictError } from '@agentos/result-errors';

/**
 * The open-Deal delete guard (RFC-002 §2.2): an Account cannot be soft-deleted while it has open
 * Deals. This is a **domain guard, not a DB cascade**. The rule lives here in the account domain; the
 * `openDealCount` is resolved by the caller (Phase 3 wires a host orchestrator that reads it via the
 * `deal` contract query, so the account module never imports `deal` — CLAUDE.md §17).
 */
export function assertAccountDeletable(openDealCount: number): void {
  if (openDealCount > 0) {
    throw new ConflictError('Account has open deals and cannot be deleted', {
      detail: `Close or reassign ${openDealCount} open deal(s) before deleting this account.`,
      meta: { openDealCount },
    });
  }
}
