import { ConflictError } from '@agentos/result-errors';

/**
 * Workspaces nest, bounded to depth ≤ 3 (CLAUDE.md §5/§15.5) — a guardrail against unbounded
 * hierarchies that would make tenant trees expensive to walk and reason about. Enforced in the
 * application layer (not a DB constraint), so this pure, I/O-free function is the single source
 * of truth and is unit-tested in isolation.
 *
 * Depth is 1-based: a root workspace is depth 1, its child depth 2, its grandchild depth 3.
 */
export const MAX_WORKSPACE_DEPTH = 3;

/**
 * Assert that a new workspace whose parent sits at `parentDepth` (0 when creating a root) stays
 * within the limit. The child's depth is `parentDepth + 1`. Throws 409 when it would exceed
 * {@link MAX_WORKSPACE_DEPTH}.
 */
export function assertDepthWithinLimit(parentDepth: number): void {
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_WORKSPACE_DEPTH) {
    throw new ConflictError(
      `Workspace nesting cannot exceed ${MAX_WORKSPACE_DEPTH} levels`,
      { detail: `Parent is already at depth ${parentDepth}` },
    );
  }
}
