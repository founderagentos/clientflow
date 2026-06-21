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
import { InvitationService, type InvitationRow } from '@agentos/workspace';
import { RequireMembershipGuard } from './require-membership.guard';
import { InvitationAcceptanceOrchestrator } from './invitation-acceptance.orchestrator';
import { currentActor, optionalPrincipalId } from './tenancy-actor';
import { acceptInvitationBodySchema, createInvitationBodySchema } from './tenancy.dto';

function toView(inv: InvitationRow) {
  return {
    id: inv.id,
    workspaceId: inv.workspaceId,
    email: inv.email,
    roleId: inv.roleId,
    status: inv.status,
    expiresAt: inv.expiresAt,
  };
}

/**
 * Invitation issuance/listing/revocation are guarded (membership required). Acceptance
 * (`POST /invitations/:token/accept`) is intentionally public — the unguessable token in the URL
 * is the authorization, and the invitee may have no account yet (signup-via-invite). The
 * issuance response returns the plaintext token exactly once (CLAUDE.md §3.20).
 */
@Controller()
export class InvitationController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly acceptance: InvitationAcceptanceOrchestrator,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  @Post('workspaces/:id/invitations')
  @HttpCode(201)
  @UseGuards(RequireMembershipGuard)
  async invite(@Param('id') workspaceId: string, @Body() body: unknown) {
    const input = createInvitationBodySchema.parse(body);
    const created = await this.invitations.invite(currentActor(), {
      workspaceId,
      email: input.email,
      roleId: input.roleId,
    });
    return {
      invitationId: created.invitationId,
      token: created.token,
      expiresAt: created.expiresAt,
    };
  }

  @Get('workspaces/:id/invitations')
  @UseGuards(RequireMembershipGuard)
  async list(@Param('id') workspaceId: string) {
    const rows = await this.invitations.list(currentActor(), workspaceId);
    return { invitations: rows.map(toView) };
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @UseGuards(RequireMembershipGuard)
  async revoke(@Param('id') invitationId: string): Promise<void> {
    await this.invitations.revoke(currentActor(), invitationId);
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  async accept(
    @Req() request: AuthRequestView,
    @Res({ passthrough: true }) reply: CookieCapableReply,
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<{ membershipId: string; newUser: boolean } | TokenResponseBody> {
    const input = acceptInvitationBodySchema.parse(body ?? {});
    const result = await this.acceptance.accept({
      token,
      authenticatedPrincipalId: optionalPrincipalId(),
      password: input.password,
      displayName: input.displayName,
      correlationId: correlationIdFrom(request, reply),
      client: clientMetaFrom(request),
    });
    // Signup-via-invite auto-logs-in: deliver the token pair. Existing-user acceptance just
    // reports the new membership.
    if (result.newUser && result.tokens) {
      return deliverTokens(reply, result.tokens, input.tokenDelivery, this.config);
    }
    return { membershipId: result.membershipId, newUser: result.newUser };
  }
}
