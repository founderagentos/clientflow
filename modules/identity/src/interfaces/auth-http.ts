import type { IssuedTokens, ClientMeta } from '../application/session-issuer';
import type { IdentityAuthConfig } from '../infrastructure/identity-auth.config';

/** Refresh cookie is path-scoped to the auth routes (global prefix `api/v1` + `auth`). */
export const AUTH_COOKIE_PATH = '/api/v1/auth';

export type TokenDelivery = 'cookie' | 'body';

export interface TokenResponseBody {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  /** Present only for `body` delivery (mobile/API clients). */
  refresh_token?: string;
}

/** Structural view of the Fastify reply we use — avoids coupling identity to @fastify/cookie's
 * type augmentation (the plugin is registered by the host). */
export interface CookieCapableReply {
  setCookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
  getHeader(name: string): unknown;
}

/** Structural view of the Fastify request fields we read. */
export interface AuthRequestView {
  ip?: string;
  headers: Record<string, unknown>;
  cookies?: Record<string, string | undefined>;
}

export function clientMetaFrom(request: AuthRequestView): ClientMeta {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

export function correlationIdFrom(request: AuthRequestView, reply: CookieCapableReply): string {
  const fromRequest = request.headers['x-correlation-id'];
  if (typeof fromRequest === 'string' && fromRequest.length > 0) {
    return fromRequest;
  }
  const fromReply = reply.getHeader('x-correlation-id');
  return typeof fromReply === 'string' ? fromReply : '';
}

export function extractRefreshToken(
  request: AuthRequestView,
  bodyToken: string | undefined,
  config: IdentityAuthConfig,
): string | undefined {
  return bodyToken ?? request.cookies?.[config.cookie.name];
}

function refreshCookieOptions(config: IdentityAuthConfig, expires?: Date): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'strict', // CSRF defense for the cookie-mode refresh route
    path: AUTH_COOKIE_PATH,
    ...(config.cookie.domain ? { domain: config.cookie.domain } : {}),
    ...(expires ? { expires } : {}),
  };
}

/**
 * Deliver the token pair per the negotiated mode: `cookie` sets an httpOnly Secure cookie and
 * returns only the access token in the body (XSS-resistant, browser default); `body` returns
 * both tokens in the JSON body (mobile/API) and sets no cookie.
 */
export function deliverTokens(
  reply: CookieCapableReply,
  tokens: IssuedTokens,
  delivery: TokenDelivery,
  config: IdentityAuthConfig,
): TokenResponseBody {
  const body: TokenResponseBody = {
    token_type: 'Bearer',
    access_token: tokens.accessToken,
    expires_in: tokens.accessTokenExpiresInSeconds,
  };
  if (delivery === 'cookie') {
    reply.setCookie(
      config.cookie.name,
      tokens.refreshToken,
      refreshCookieOptions(config, tokens.refreshTokenExpiresAt),
    );
  } else {
    body.refresh_token = tokens.refreshToken;
  }
  return body;
}

export function clearRefreshCookie(reply: CookieCapableReply, config: IdentityAuthConfig): void {
  reply.clearCookie(config.cookie.name, refreshCookieOptions(config));
}
