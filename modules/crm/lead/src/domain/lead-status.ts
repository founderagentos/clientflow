import { ConflictError, ValidationError } from '@agentos/result-errors';
import { LeadStatus } from '@agentos/contracts';

const VALID_STATUSES: ReadonlySet<string> = new Set(Object.values(LeadStatus));

/**
 * Convertibility + status-change guards (RFC-002 §2.2). A lead is convertible from `new`/`working`/
 * `qualified` — never `unqualified` (terminal) and never once already converted. Conversion itself
 * sets `status = qualified` (the service's job, not this guard's). Both guards are self-contained
 * (take `convertedAt` explicitly) so they hold even if called outside the orchestrator's own
 * already-converted short-circuit — defense in depth, not redundant.
 */
export function assertConvertible(status: LeadStatus, convertedAt: Date | null): void {
  if (convertedAt) {
    throw new ConflictError('Lead has already been converted');
  }
  if (status === LeadStatus.Unqualified) {
    throw new ConflictError('An unqualified lead cannot be converted');
  }
}

export function assertStatusChange(
  from: LeadStatus,
  to: LeadStatus,
  convertedAt: Date | null,
): void {
  if (convertedAt) {
    throw new ConflictError('Cannot change the status of a converted lead');
  }
  if (!VALID_STATUSES.has(to)) {
    throw new ValidationError(`Unknown lead status: ${to}`);
  }
  if (from === to) {
    throw new ValidationError('Lead is already in this status');
  }
}
