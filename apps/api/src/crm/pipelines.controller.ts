import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { PipelineService } from '@agentos/crm-deal';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { asInput, crmActor } from './crm-http';
import {
  addStageBodySchema,
  createPipelineBodySchema,
  reorderStagesBodySchema,
  toBoardView,
  toPipelineView,
  toStageView,
  updatePipelineBodySchema,
  updateStageBodySchema,
} from './pipelines.dto';

/**
 * Pipeline & stage configuration API (`/api/v1/pipelines`, RFC-002 §7). Reads need `pipeline.read`;
 * every mutation needs `pipeline.manage`. The board is an index-scoped aggregation (deal counts +
 * amount sums per stage). Stage reorder is a `PUT` of the complete, ordered stage-id set.
 */
@Controller('pipelines')
@UseGuards(RequirePermissionGuard)
export class PipelinesController {
  constructor(private readonly pipelines: PipelineService) {}

  @Get()
  @RequirePermission('pipeline.read')
  async list() {
    return (await this.pipelines.list(crmActor())).map(toPipelineView);
  }

  @Post()
  @RequirePermission('pipeline.manage')
  async create(@Body() body: unknown) {
    const input = createPipelineBodySchema.parse(body);
    return toPipelineView(await this.pipelines.create(crmActor(), asInput(input)));
  }

  @Patch(':id')
  @RequirePermission('pipeline.manage')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updatePipelineBodySchema.parse(body);
    return toPipelineView(await this.pipelines.update(crmActor(), id, expectedVersion, asInput(fields)));
  }

  @Get(':id/board')
  @RequirePermission('pipeline.read')
  async board(@Param('id') id: string) {
    return toBoardView(await this.pipelines.getBoard(crmActor(), id));
  }

  @Post(':id/stages')
  @RequirePermission('pipeline.manage')
  async addStage(@Param('id') id: string, @Body() body: unknown) {
    const input = addStageBodySchema.parse(body);
    return toStageView(await this.pipelines.addStage(crmActor(), id, asInput(input)));
  }

  @Patch(':id/stages/:stageId')
  @RequirePermission('pipeline.manage')
  async updateStage(@Param('stageId') stageId: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateStageBodySchema.parse(body);
    return toStageView(await this.pipelines.updateStage(crmActor(), stageId, expectedVersion, asInput(fields)));
  }

  @Put(':id/stages')
  @HttpCode(204)
  @RequirePermission('pipeline.manage')
  async reorderStages(@Param('id') id: string, @Body() body: unknown) {
    const { stageIds } = reorderStagesBodySchema.parse(body);
    await this.pipelines.reorderStages(crmActor(), id, stageIds);
  }
}
