import { z } from 'zod';

export const tokenDeliverySchema = z.enum(['cookie', 'body']).default('cookie');

/** Login bounds the password length (anti-DoS) but does not re-assert the full creation policy
 * — that belongs to registration; here any non-empty string is a candidate to verify. */
export const loginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
  tokenDelivery: tokenDeliverySchema,
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
  tokenDelivery: tokenDeliverySchema,
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type LogoutBody = z.infer<typeof logoutBodySchema>;
