import { ConflictError, ValidationError } from '@agentos/result-errors';

export type StageCategory = 'open' | 'won' | 'lost';

export interface StageRef {
  id: string;
  pipelineId: string;
  category: StageCategory;
}

export type TransitionDecision =
  | { kind: 'allowed'; terminal: 'won' | 'lost' | null }
  | { kind: 'rejected'; error: 'wrong_pipeline' | 'missing_close_reason' | 'terminal' | 'same_stage' };

/**
 * Pure stage-transition guard (RFC-002 §2.2/§4.D). Decides whether a Deal may move from `from` to
 * `to`, given whether a `closeReason` was supplied. Rules:
 *  - the target stage must belong to the same pipeline as the deal;
 *  - a terminal source stage (won/lost) is terminal — no transition out (no reopen);
 *  - a no-op transition to the current stage is rejected;
 *  - reaching a terminal target (won/lost) requires a close reason.
 * No I/O — fully unit-testable.
 */
export function decideTransition(
  from: StageRef,
  to: StageRef,
  closeReason: string | null,
): TransitionDecision {
  if (to.pipelineId !== from.pipelineId) {
    return { kind: 'rejected', error: 'wrong_pipeline' };
  }
  if (from.category !== 'open') {
    return { kind: 'rejected', error: 'terminal' };
  }
  if (to.id === from.id) {
    return { kind: 'rejected', error: 'same_stage' };
  }
  if (to.category !== 'open' && !hasCloseReason(closeReason)) {
    return { kind: 'rejected', error: 'missing_close_reason' };
  }
  return { kind: 'allowed', terminal: to.category === 'open' ? null : to.category };
}

/**
 * Assert a transition is allowed, throwing the mapped platform error otherwise. A bad request
 * (wrong pipeline / missing close reason) is a 422 ValidationError; a state conflict (the deal is
 * already closed, or already in the target stage) is a 409 ConflictError.
 */
export function assertTransitionAllowed(
  from: StageRef,
  to: StageRef,
  closeReason: string | null,
): { terminal: 'won' | 'lost' | null } {
  const decision = decideTransition(from, to, closeReason);
  if (decision.kind === 'allowed') {
    return { terminal: decision.terminal };
  }
  switch (decision.error) {
    case 'wrong_pipeline':
      throw new ValidationError('The target stage does not belong to this deal’s pipeline');
    case 'missing_close_reason':
      throw new ValidationError('A close reason is required to win or lose a deal');
    case 'terminal':
      throw new ConflictError('The deal is closed and cannot be moved to another stage');
    case 'same_stage':
      throw new ConflictError('The deal is already in this stage');
  }
}

function hasCloseReason(closeReason: string | null): boolean {
  return closeReason !== null && closeReason.trim().length > 0;
}
