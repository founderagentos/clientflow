/**
 * Acting principal + active tenant context, resolved by the host from the access token (Phase 6
 * controllers) — services never read ambient context, they receive it explicitly (kernel pattern).
 * Unlike the kernel `WorkspaceActor`, `workspaceId` is **required**: CRM business records are
 * workspace-scoped (RFC-002 §2.3), so a write with no active workspace is a programming error.
 */
export interface CrmActor {
  principalId: string;
  organizationId: string;
  workspaceId: string;
  correlationId: string;
}
