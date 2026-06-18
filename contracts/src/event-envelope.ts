import { z } from 'zod';

/**
 * The platform-wide domain-event envelope — the integration boundary between modules
 * (CLAUDE.md §17). Events are PastTense (§3.15) and MUST carry tenant + causation context:
 * organization_id, workspace_id, actor_principal_id, correlation_id, causation_id.
 * Events without tenant context are prohibited.
 */
export const domainEventEnvelopeSchema = z.object({
  /** UUIDv7 of the event. */
  id: z.string(),
  /** PastTense event type, e.g. 'UserRegistered', 'WorkspaceCreated', 'RoleAssigned'. */
  type: z.string().min(1),
  /** Schema version of the payload for this event type. */
  version: z.number().int().positive(),
  /** ISO-8601 timestamp the event occurred. */
  occurredAt: z.string().datetime(),
  organizationId: z.string(),
  /** null = org-scoped event. */
  workspaceId: z.string().nullable(),
  /** The principal (human or service account) responsible for the change (§3.2). */
  actorPrincipalId: z.string(),
  /** Correlation id threaded across HTTP and events (§3.15/§3.20). */
  correlationId: z.string(),
  /** The event/command that caused this one, if any. */
  causationId: z.string().nullable(),
  /** Event-type-specific data. */
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;
