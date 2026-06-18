import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  IDENTITY_AUTH_CONFIG,
  type IdentityAuthConfig,
  type AuthRequestView,
  type CookieCapableReply,
  type TokenResponseBody,
  clientMetaFrom,
  correlationIdFrom,
  deliverTokens,
} from '@agentos/identity';
import { RegistrationOrchestrator } from './registration.orchestrator';
import { registerBodySchema } from './register.dto';

/**
 * `POST /api/v1/auth/register` — hosted here (not in identity) because it provisions a tenant
 * across contexts (CLAUDE.md §3.1/§17). A duplicate email returns 409 (documented enumeration
 * trade-off; email-verification is a future seam).
 */
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly orchestrator: RegistrationOrchestrator,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Req() request: AuthRequestView,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Body() body: unknown,
  ): Promise<TokenResponseBody> {
    const { email, password, displayName, tokenDelivery } = registerBodySchema.parse(body);
    const result = await this.orchestrator.register({
      email,
      password,
      displayName,
      correlationId: correlationIdFrom(request, reply),
      client: clientMetaFrom(request),
    });
    return deliverTokens(reply, result.tokens, tokenDelivery, this.config);
  }
}
