import { z } from 'zod';

/** A slug: lowercase alphanumeric words separated by single hyphens. */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphen-separated slug');

const expectedVersion = z.coerce.number().int().positive();

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    homeRegion: z.string().trim().min(1).max(64).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    expectedVersion,
  })
  .refine(
    (b) => b.name !== undefined || b.homeRegion !== undefined || b.metadata !== undefined,
    { message: 'At least one field must be provided' },
  );

export const consentBodySchema = z.object({
  consent: z.boolean(),
  expectedVersion,
});

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  parentWorkspaceId: z.string().uuid().nullable().optional(),
});

export const updateWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    expectedVersion,
  })
  .refine((b) => b.name !== undefined || b.slug !== undefined, {
    message: 'At least one field must be provided',
  });

export const archiveWorkspaceBodySchema = z.object({
  expectedVersion,
});

export const createInvitationBodySchema = z.object({
  email: z.string().email().max(320),
  roleId: z.string().uuid(),
});

/**
 * Invitation acceptance. With a bearer token it is an existing-user join (body may be empty);
 * without one it is signup-via-invite and `password` + `displayName` are required (CLAUDE.md §6
 * Phase 3, decision: support both). The orchestrator decides which path applies.
 */
export const acceptInvitationBodySchema = z.object({
  password: z.string().min(1).max(128).optional(),
  displayName: z.string().trim().min(1).max(200).optional(),
  tokenDelivery: z.enum(['cookie', 'body']).default('cookie'),
});

export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;
export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;
