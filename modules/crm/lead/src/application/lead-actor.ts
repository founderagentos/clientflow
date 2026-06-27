/**
 * Acting principal + active tenant context, resolved by the host from the access token. Structurally
 * identical to the account/deal modules' actor types, but defined locally: the global `type:module`
 * Nx rule forbids one CRM module importing another (CLAUDE.md §17), so the host (which depends on
 * all three) passes one actor object that satisfies every shape by structural typing. `workspaceId`
 * is required — leads are workspace-scoped (RFC-002 §2.3).
 */
export interface LeadActor {
  principalId: string;
  organizationId: string;
  workspaceId: string;
  correlationId: string;
  /** Human vs agent — carried for the PDP query + actor attribution (parity, §3.2). Default user. */
  principalType?: 'user' | 'service_account';
}
