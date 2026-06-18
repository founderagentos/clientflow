import { z } from 'zod';
import { passwordSchema } from '@agentos/identity';

/** Registration input. Password enforces the full creation policy (identity domain); the org
 * name is derived from the display name (no separate org-name field in Phase 2). */
export const registerBodySchema = z.object({
  email: z.string().email().max(320),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(200),
  tokenDelivery: z.enum(['cookie', 'body']).default('cookie'),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
