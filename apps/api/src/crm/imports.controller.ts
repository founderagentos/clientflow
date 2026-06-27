import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { SkipIdempotency } from '../http/idempotency.decorator';
import { BulkImportOrchestrator } from './bulk-import.orchestrator';
import { crmActor } from './crm-http';
import { importCsvSchema, importKeySchema, toImportJobView } from './imports.dto';

/**
 * Bulk-import API (`/api/v1/imports`, RFC-002 §7). `POST` accepts a raw `text/csv` body + an
 * `Idempotency-Key` header, enqueues the BullMQ job, and returns 202. It is `@SkipIdempotency()` — the
 * generic replay middleware is bypassed because the import owns its own domain-level idempotency on
 * that key (a resubmit returns the same job, enqueuing nothing). `GET :id` reports status + counts.
 */
@Controller('imports')
@UseGuards(RequirePermissionGuard)
export class ImportsController {
  constructor(private readonly orchestrator: BulkImportOrchestrator) {}

  @Post()
  @HttpCode(202)
  @SkipIdempotency()
  @RequirePermission('lead.import')
  async submit(@Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    const idempotencyKey = importKeySchema.parse(key);
    const csv = importCsvSchema.parse(body);
    return this.orchestrator.submit(crmActor(), { idempotencyKey, csv });
  }

  @Get(':id')
  @RequirePermission('lead.read')
  async getJob(@Param('id') id: string) {
    return toImportJobView(await this.orchestrator.getJob(crmActor(), id));
  }
}
