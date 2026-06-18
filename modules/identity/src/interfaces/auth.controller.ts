import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UnauthenticatedError } from '@agentos/result-errors';
import { IDENTITY_AUTH_CONFIG, type IdentityAuthConfig } from '../infrastructure/identity-auth.config';
import { LoginService } from '../application/login.service';
import { RefreshService } from '../application/refresh.service';
import { LogoutService } from '../application/logout.service';
import { SessionsService } from '../application/sessions.service';
import { UsersRepository } from '../infrastructure/users.repository';
import { AccessTokenGuard, requireAuth } from './access-token.guard';
import type { RequestWithAuth } from './auth-context';
import { loginBodySchema, refreshBodySchema, logoutBodySchema } from './auth.dto';
import {
  type AuthRequestView,
  type CookieCapableReply,
  type TokenResponseBody,
  clientMetaFrom,
  clearRefreshCookie,
  correlationIdFrom,
  deliverTokens,
  extractRefreshToken,
} from './auth-http';

/**
 * Authentication endpoints (CLAUDE.md §19 — `/api/v1/auth`, verbs carry the action). Registration
 * lives at the host (`/auth/register`) because it provisions a tenant across several contexts;
 * these are the pure-identity operations. Bodies are Zod-validated (ZodError → RFC 9457 422 via
 * the global filter). `@Res({ passthrough: true })` lets handlers set the refresh cookie while
 * Nest still serializes the returned body.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginService: LoginService,
    private readonly refreshService: RefreshService,
    private readonly logoutService: LogoutService,
    private readonly sessionsService: SessionsService,
    private readonly users: UsersRepository,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: AuthRequestView,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Body() body: unknown,
  ): Promise<TokenResponseBody> {
    const { email, password, tokenDelivery } = loginBodySchema.parse(body);
    const tokens = await this.loginService.login({
      email,
      password,
      correlationId: correlationIdFrom(request, reply),
      client: clientMetaFrom(request),
    });
    return deliverTokens(reply, tokens, tokenDelivery, this.config);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: AuthRequestView,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Body() body: unknown,
  ): Promise<TokenResponseBody> {
    const { refreshToken: bodyToken, tokenDelivery } = refreshBodySchema.parse(body);
    const refreshToken = extractRefreshToken(request, bodyToken, this.config);
    if (!refreshToken) {
      throw new UnauthenticatedError('Missing refresh token');
    }
    const tokens = await this.refreshService.refresh({
      refreshToken,
      correlationId: correlationIdFrom(request, reply),
      client: clientMetaFrom(request),
    });
    return deliverTokens(reply, tokens, tokenDelivery, this.config);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthRequestView,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Body() body: unknown,
  ): Promise<void> {
    const { refreshToken: bodyToken } = logoutBodySchema.parse(body ?? {});
    const refreshToken = extractRefreshToken(request, bodyToken, this.config);
    if (refreshToken) {
      await this.logoutService.logout({
        refreshToken,
        correlationId: correlationIdFrom(request, reply),
      });
    }
    clearRefreshCookie(reply, this.config);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: RequestWithAuth): Promise<{
    principalId: string;
    email: string | null;
    displayName: string | null;
    organizationId: string;
    workspaceId: string | null;
  }> {
    const auth = requireAuth(request);
    const user = await this.users.findById(auth.principalId);
    return {
      principalId: auth.principalId,
      email: user?.primaryEmail ?? null,
      displayName: user?.displayName ?? null,
      organizationId: auth.organizationId,
      workspaceId: auth.workspaceId,
    };
  }

  @Get('sessions')
  @UseGuards(AccessTokenGuard)
  async listSessions(@Req() request: RequestWithAuth) {
    const auth = requireAuth(request);
    const sessions = await this.sessionsService.list(auth.principalId);
    return { sessions };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async revokeSession(
    @Req() request: AuthRequestView & RequestWithAuth,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Param('id') sessionId: string,
  ): Promise<void> {
    const auth = requireAuth(request);
    await this.sessionsService.revoke(sessionId, {
      principalId: auth.principalId,
      organizationId: auth.organizationId,
      workspaceId: auth.workspaceId,
      correlationId: correlationIdFrom(request, reply),
    });
  }
}
