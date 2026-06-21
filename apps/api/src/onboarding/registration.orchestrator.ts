import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@agentos/identifier';
import {
  DATABASE,
  OUTBOX,
  withTenantTransaction,
  type Database,
  type OutboxPort,
} from '@agentos/persistence-kernel';
import { AccessEventType, IdentityAggregateType, IdentityEventType } from '@agentos/contracts';
import {
  PasswordHasher,
  UserRegistrar,
  SessionIssuer,
  type ClientMeta,
  type IssuedTokens,
} from '@agentos/identity';
import { OrganizationProvisioner } from '@agentos/organization';
import { WorkspaceProvisioner, MembershipWriter } from '@agentos/workspace';
import { RoleAssigner } from '@agentos/access';
import { buildOrganizationSlug } from './slug';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  correlationId: string;
  client?: ClientMeta;
}

export interface RegisterResult {
  principalId: string;
  organizationId: string;
  workspaceId: string;
  tokens: IssuedTokens;
}

/**
 * Cross-context onboarding orchestration (CLAUDE.md §3.1). Lives at the host — the only layer
 * permitted to depend on multiple bounded contexts (§17) — and composes each module's public
 * provisioning service into ONE atomic transaction: identity (principal/user/identity) →
 * organization → workspace → membership → Owner role → first session, plus every domain event
 * to the outbox in the same unit of work (§3.14, gate §7.6).
 *
 * Ordering note (RLS): `organizationId` is generated up front and set as the tenant key by
 * `withTenantTransaction`, so the `organizations` insert satisfies its own `id =
 * app.current_organization_id` policy. The password is hashed before the transaction opens to
 * keep the slow Argon2 KDF off the held connection.
 */
@Injectable()
export class RegistrationOrchestrator {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly userRegistrar: UserRegistrar,
    private readonly organizations: OrganizationProvisioner,
    private readonly workspaces: WorkspaceProvisioner,
    private readonly memberships: MembershipWriter,
    private readonly roles: RoleAssigner,
    private readonly sessionIssuer: SessionIssuer,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const principalId = newId();
    const organizationId = newId();
    const workspaceId = newId();
    const membershipId = newId();

    const displayName = input.displayName.trim();
    const passwordHash = await this.hasher.hash(input.password);
    const slug = buildOrganizationSlug(displayName);
    const organizationName = `${displayName}'s Organization`;

    return withTenantTransaction(
      this.db,
      { organizationId, workspaceId: null },
      async (tx) => {
        const registered = await this.userRegistrar.create(tx, {
          principalId,
          email: input.email,
          displayName,
          passwordHash,
        });
        const org = await this.organizations.provisionPersonal(tx, {
          organizationId,
          name: organizationName,
          slug,
          actorPrincipalId: principalId,
        });
        const workspace = await this.workspaces.createDefault(tx, {
          organizationId,
          workspaceId,
          actorPrincipalId: principalId,
        });
        await this.memberships.grantOwnerMembership(tx, {
          membershipId,
          organizationId,
          principalId,
          actorPrincipalId: principalId,
        });
        const role = await this.roles.assignOwner(tx, { membershipId });

        // The new account is auto-logged-in: a fresh principal has token_version 0. Active
        // context is org-level (ws null) — consistent with login; workspace selection is Phase 3.
        const tokens = await this.sessionIssuer.issue(tx, {
          principalId,
          tokenVersion: 0,
          organizationId,
          workspaceId: null,
          client: input.client,
        });

        const base = {
          organizationId,
          workspaceId: null,
          actorPrincipalId: principalId,
          correlationId: input.correlationId,
          causationId: null,
        };
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.User,
          aggregateId: principalId,
          type: IdentityEventType.UserRegistered,
          payload: { userId: registered.userId, email: registered.email, displayName },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.Organization,
          aggregateId: organizationId,
          type: IdentityEventType.OrganizationProvisioned,
          payload: { organizationId, slug: org.slug, name: org.name },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.Workspace,
          aggregateId: workspaceId,
          type: IdentityEventType.WorkspaceCreated,
          payload: { workspaceId, slug: workspace.slug, name: workspace.name },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.Membership,
          aggregateId: membershipId,
          type: IdentityEventType.OwnerMembershipGranted,
          payload: { membershipId, principalId },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.Membership,
          aggregateId: membershipId,
          type: AccessEventType.RoleAssigned,
          payload: { membershipId, roleId: role.roleId, principalId, roleName: role.roleName },
        });
        await this.outbox.append(tx, {
          ...base,
          aggregateType: IdentityAggregateType.Session,
          aggregateId: tokens.sessionId,
          type: IdentityEventType.SessionCreated,
          payload: { sessionId: tokens.sessionId, familyId: tokens.familyId },
        });

        return { principalId, organizationId, workspaceId, tokens };
      },
    );
  }
}
