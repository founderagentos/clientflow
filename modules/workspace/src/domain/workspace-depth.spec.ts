import { describe, it, expect } from 'vitest';
import { assertDepthWithinLimit, MAX_WORKSPACE_DEPTH } from './workspace-depth';
import { ConflictError } from '@agentos/result-errors';

describe('assertDepthWithinLimit', () => {
  it('allows a root workspace (parent depth 0 → child depth 1)', () => {
    expect(() => assertDepthWithinLimit(0)).not.toThrow();
  });

  it('allows nesting up to the limit (parent at depth 2 → child depth 3)', () => {
    expect(() => assertDepthWithinLimit(1)).not.toThrow();
    expect(() => assertDepthWithinLimit(MAX_WORKSPACE_DEPTH - 1)).not.toThrow();
  });

  it('rejects a child that would exceed the limit (parent already at max depth)', () => {
    expect(() => assertDepthWithinLimit(MAX_WORKSPACE_DEPTH)).toThrow(ConflictError);
  });

  it('rejects deeper-than-max parents too', () => {
    expect(() => assertDepthWithinLimit(MAX_WORKSPACE_DEPTH + 5)).toThrow(ConflictError);
  });
});
