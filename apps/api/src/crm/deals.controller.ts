import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { DealService } from '@agentos/crm-deal';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { asInput, crmActor, decodeCursor, listQuerySchema, pageResult, versionBodySchema } from './crm-http';
import {
  assignDealBodySchema,
  closeDealBodySchema,
  createDealBodySchema,
  toDealView,
  transitionDealBodySchema,
  updateDealBodySchema,
} from './deals.dto';

/**
 * Deal API (`/api/v1/deals`, RFC-002 §7). CRUD plus the action sub-resources `:id/assignment`,
 * `:id/stage-transitions`, and `:id/closure` — each its own permission and domain guard. Every
 * mutation asserts the optimistic-lock `expectedVersion` (→ 409). Ownership narrowing + RLS apply.
 */
@Controller('deals')
@UseGuards(RequirePermissionGuard)
export class DealsController {
  constructor(private readonly deals: DealService) {}

  @Get()
  @RequirePermission('deal.read')
  async list(@Query() query: unknown) {
    const { limit, cursor } = listQuerySchema.parse(query);
    const rows = await this.deals.list(crmActor(), asInput({ limit, cursor: decodeCursor(cursor) }));
    return pageResult(rows, limit, toDealView);
  }

  @Post()
  @RequirePermission('deal.create')
  async create(@Body() body: unknown) {
    const input = createDealBodySchema.parse(body);
    return toDealView(await this.deals.create(crmActor(), asInput(input)));
  }

  @Get(':id')
  @RequirePermission('deal.read')
  async get(@Param('id') id: string) {
    return toDealView(await this.deals.get(crmActor(), id));
  }

  @Patch(':id')
  @RequirePermission('deal.update')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateDealBodySchema.parse(body);
    return toDealView(await this.deals.update(crmActor(), id, expectedVersion, asInput(fields)));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('deal.delete')
  async archive(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = versionBodySchema.parse(body);
    await this.deals.archive(crmActor(), id, expectedVersion);
  }

  @Post(':id/assignment')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('deal.assign')
  async assign(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ownerPrincipalId } = assignDealBodySchema.parse(body);
    return toDealView(await this.deals.assign(crmActor(), id, expectedVersion, ownerPrincipalId));
  }

  @Post(':id/stage-transitions')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('deal.transition')
  async transition(@Param('id') id: string, @Body() body: unknown) {
    const input = transitionDealBodySchema.parse(body);
    return toDealView(await this.deals.transition(crmActor(), asInput({ dealId: id, ...input })));
  }

  @Post(':id/closure')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('deal.close')
  async close(@Param('id') id: string, @Body() body: unknown) {
    const input = closeDealBodySchema.parse(body);
    return toDealView(await this.deals.close(crmActor(), { dealId: id, ...input }));
  }
}
