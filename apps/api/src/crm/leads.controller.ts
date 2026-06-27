import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { LeadService } from '@agentos/crm-lead';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { LeadConversionOrchestrator } from './lead-conversion.orchestrator';
import { asInput, crmActor, decodeCursor, listQuerySchema, pageResult } from './crm-http';
import {
  assignLeadBodySchema,
  createLeadBodySchema,
  mergeLeadBodySchema,
  statusChangeBodySchema,
  toLeadView,
  updateLeadBodySchema,
} from './leads.dto';

/**
 * Lead API (`/api/v1/leads`, RFC-002 §7). CRUD (no DELETE — a lead ends via merge or terminal status)
 * plus the action sub-resources `:id/assignment`, `:id/status-changes`, `:id/merges`, and the atomic,
 * one-shot `:id/conversion` (host orchestrator → Account+Contact+Deal). Ownership narrowing + RLS apply.
 */
@Controller('leads')
@UseGuards(RequirePermissionGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadService,
    private readonly conversion: LeadConversionOrchestrator,
  ) {}

  @Get()
  @RequirePermission('lead.read')
  async list(@Query() query: unknown) {
    const { limit, cursor } = listQuerySchema.parse(query);
    const rows = await this.leads.list(crmActor(), asInput({ limit, cursor: decodeCursor(cursor) }));
    return pageResult(rows, limit, toLeadView);
  }

  @Post()
  @RequirePermission('lead.create')
  async create(@Body() body: unknown) {
    const input = createLeadBodySchema.parse(body);
    return toLeadView(await this.leads.create(crmActor(), asInput(input)));
  }

  @Get(':id')
  @RequirePermission('lead.read')
  async get(@Param('id') id: string) {
    return toLeadView(await this.leads.get(crmActor(), id));
  }

  @Patch(':id')
  @RequirePermission('lead.update')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateLeadBodySchema.parse(body);
    return toLeadView(await this.leads.update(crmActor(), id, expectedVersion, asInput(fields)));
  }

  @Post(':id/assignment')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lead.assign')
  async assign(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ownerPrincipalId } = assignLeadBodySchema.parse(body);
    return toLeadView(await this.leads.assign(crmActor(), id, expectedVersion, ownerPrincipalId));
  }

  @Post(':id/status-changes')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('lead.update')
  async changeStatus(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, status } = statusChangeBodySchema.parse(body);
    return toLeadView(await this.leads.changeStatus(crmActor(), id, expectedVersion, status));
  }

  @Post(':id/merges')
  @HttpCode(204)
  @RequirePermission('lead.merge')
  async merge(@Param('id') survivorId: string, @Body() body: unknown) {
    const { mergedId, expectedVersion } = mergeLeadBodySchema.parse(body);
    await this.leads.merge(crmActor(), survivorId, mergedId, expectedVersion);
  }

  @Post(':id/conversion')
  @RequirePermission('lead.convert')
  async convert(@Param('id') id: string) {
    return this.conversion.convert(crmActor(), id);
  }
}
