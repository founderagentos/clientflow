import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ContactService } from '@agentos/crm-account';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { asInput, crmActor, decodeCursor, listQuerySchema, pageResult, versionBodySchema } from './crm-http';
import { createContactBodySchema, toContactView, updateContactBodySchema } from './contacts.dto';

/**
 * Contact API (`/api/v1/contacts`, RFC-002 §7). Holds PII; reads/writes are ownership-narrowed (the
 * service enforces owner-or-manager, RLS scopes to org+workspace). `POST :id/erasure` is the sensitive
 * GDPR/DPDP erase (§8.4) — gated to the elevated `contact.erase` permission and audited.
 */
@Controller('contacts')
@UseGuards(RequirePermissionGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactService) {}

  @Get()
  @RequirePermission('contact.read')
  async list(@Query() query: unknown) {
    const { limit, cursor } = listQuerySchema.parse(query);
    const rows = await this.contacts.list(crmActor(), asInput({ limit, cursor: decodeCursor(cursor) }));
    return pageResult(rows, limit, toContactView);
  }

  @Post()
  @RequirePermission('contact.create')
  async create(@Body() body: unknown) {
    const input = createContactBodySchema.parse(body);
    return toContactView(await this.contacts.create(crmActor(), asInput(input)));
  }

  @Get(':id')
  @RequirePermission('contact.read')
  async get(@Param('id') id: string) {
    return toContactView(await this.contacts.get(crmActor(), id));
  }

  @Patch(':id')
  @RequirePermission('contact.update')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateContactBodySchema.parse(body);
    return toContactView(await this.contacts.update(crmActor(), id, expectedVersion, asInput(fields)));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('contact.delete')
  async archive(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = versionBodySchema.parse(body);
    await this.contacts.archive(crmActor(), id, expectedVersion);
  }

  @Post(':id/erasure')
  @HttpCode(204)
  @RequirePermission('contact.erase')
  async erase(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = versionBodySchema.parse(body);
    await this.contacts.erase(crmActor(), id, expectedVersion);
  }
}
