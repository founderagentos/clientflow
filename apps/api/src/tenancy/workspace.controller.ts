import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService, MembershipService, type WorkspaceRow, type MembershipRow } from '@agentos/workspace';
import { RequireMembershipGuard } from './require-membership.guard';
import { currentActor } from './tenancy-actor';
import {
  archiveWorkspaceBodySchema,
  createWorkspaceBodySchema,
  updateWorkspaceBodySchema,
} from './tenancy.dto';

function toView(ws: WorkspaceRow) {
  return {
    id: ws.id,
    organizationId: ws.organizationId,
    parentWorkspaceId: ws.parentWorkspaceId,
    slug: ws.slug,
    name: ws.name,
    status: ws.status,
    version: ws.version,
  };
}

function toMemberView(m: MembershipRow) {
  return { id: m.id, principalId: m.principalId, workspaceId: m.workspaceId, status: m.status };
}

/**
 * Workspace CRUD + member listing (CLAUDE.md §19 — `/api/v1/workspaces`). Nesting is bounded to
 * depth ≤ 3 by the service; archive is a cascading soft-delete (§3.4). Cross-tenant ids return
 * 404 via RLS (§3.8). Hosted here (not in the workspace module) because auth is an identity
 * concern a module may not import (§17).
 */
@Controller('workspaces')
@UseGuards(RequireMembershipGuard)
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly memberships: MembershipService,
  ) {}

  @Get()
  async list() {
    const rows = await this.workspaces.list(currentActor());
    return { workspaces: rows.map(toView) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = createWorkspaceBodySchema.parse(body);
    return toView(
      await this.workspaces.create(currentActor(), {
        name: input.name,
        slug: input.slug,
        parentWorkspaceId: input.parentWorkspaceId ?? null,
      }),
    );
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return toView(await this.workspaces.get(currentActor(), id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateWorkspaceBodySchema.parse(body);
    return toView(await this.workspaces.update(currentActor(), id, expectedVersion, fields));
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    const { expectedVersion } = archiveWorkspaceBodySchema.parse(body ?? {});
    await this.workspaces.archive(currentActor(), id, expectedVersion);
  }

  @Get(':id/members')
  async members(@Param('id') id: string) {
    // RLS scopes the read to the caller's org; confirm the workspace is visible first so a
    // cross-tenant id yields 404 rather than a silently empty list.
    const actor = currentActor();
    await this.workspaces.get(actor, id);
    const rows = await this.memberships.listMembers(actor, id);
    return { members: rows.map(toMemberView) };
  }
}
