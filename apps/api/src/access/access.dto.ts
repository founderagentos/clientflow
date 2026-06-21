import { z } from 'zod';

/** Edge validation for the access HTTP surface (CLAUDE.md §2 — Zod at every boundary). */

export const createRoleBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(['organization', 'workspace']),
});

export const renameRoleBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().positive(),
});

export const archiveBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const grantPermissionBodySchema = z.object({
  permissionKey: z.string().trim().min(1),
});

export const assignRoleBodySchema = z.object({
  roleId: z.string().uuid(),
});

export const createServiceAccountBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['agent', 'automation', 'integration']),
  workspaceId: z.string().uuid(),
  description: z.string().trim().max(1000).optional(),
  /** Optional role to grant the new service account so it can act immediately. */
  roleId: z.string().uuid().optional(),
});

export const issueApiKeyBodySchema = z.object({
  expiresAt: z.string().datetime().optional(),
});

export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;
export type CreateServiceAccountBody = z.infer<typeof createServiceAccountBodySchema>;
