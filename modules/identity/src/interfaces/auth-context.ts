/**
 * The authenticated principal resolved from a verified access token and attached to the
 * request by the host's tenant-context middleware. Read by {@link AccessTokenGuard} and the
 * authenticated controllers. Defined here (not in the app) so identity can depend on the shape
 * without importing the composition root (CLAUDE.md §17).
 */
export interface AuthContext {
  principalId: string;
  organizationId: string;
  workspaceId: string | null;
  tokenVersion: number;
}

/** Conventional request property name the middleware writes and the guard/controllers read. */
export interface RequestWithAuth {
  auth?: AuthContext;
}
