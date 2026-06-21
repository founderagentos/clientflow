import { describe, expect, it } from 'vitest';
import { computeEffectivePermissions, type ResolvedGrantRow } from './effective-permissions';

const WS_A = 'ws-a';
const WS_B = 'ws-b';

describe('computeEffectivePermissions', () => {
  it('org-level membership + org-scoped role applies to every workspace and to org-scoped checks', () => {
    const rows: ResolvedGrantRow[] = [
      { membershipWorkspaceId: null, roleScope: 'organization', permissionKey: 'organization.read' },
    ];
    expect(computeEffectivePermissions(rows, { workspaceId: null })).toEqual(new Set(['organization.read']));
    expect(computeEffectivePermissions(rows, { workspaceId: WS_A })).toEqual(new Set(['organization.read']));
    expect(computeEffectivePermissions(rows, { workspaceId: WS_B })).toEqual(new Set(['organization.read']));
  });

  it('workspace-level membership is confined to its own workspace', () => {
    const rows: ResolvedGrantRow[] = [
      { membershipWorkspaceId: WS_A, roleScope: 'workspace', permissionKey: 'workspace.read' },
    ];
    expect(computeEffectivePermissions(rows, { workspaceId: WS_A })).toEqual(new Set(['workspace.read']));
    expect(computeEffectivePermissions(rows, { workspaceId: WS_B })).toEqual(new Set());
    // org-scoped check ignores workspace memberships entirely
    expect(computeEffectivePermissions(rows, { workspaceId: null })).toEqual(new Set());
  });

  it('org-scoped check ignores a workspace-scoped role even on an org-level membership', () => {
    const rows: ResolvedGrantRow[] = [
      { membershipWorkspaceId: null, roleScope: 'workspace', permissionKey: 'workspace.read' },
    ];
    expect(computeEffectivePermissions(rows, { workspaceId: null })).toEqual(new Set());
  });

  it('unions permissions across multiple memberships/roles for a target workspace', () => {
    const rows: ResolvedGrantRow[] = [
      { membershipWorkspaceId: null, roleScope: 'organization', permissionKey: 'organization.read' },
      { membershipWorkspaceId: WS_A, roleScope: 'workspace', permissionKey: 'workspace.read' },
      { membershipWorkspaceId: WS_A, roleScope: 'workspace', permissionKey: 'member.read' },
      { membershipWorkspaceId: WS_B, roleScope: 'workspace', permissionKey: 'workspace.delete' },
    ];
    expect(computeEffectivePermissions(rows, { workspaceId: WS_A })).toEqual(
      new Set(['organization.read', 'workspace.read', 'member.read']),
    );
  });

  it('returns an empty set when there are no grants (default-deny upstream)', () => {
    expect(computeEffectivePermissions([], { workspaceId: WS_A })).toEqual(new Set());
  });
});
