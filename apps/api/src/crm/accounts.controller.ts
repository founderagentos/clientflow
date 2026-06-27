import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AccountService, AccountContactService } from '@agentos/crm-account';
import { RequirePermissionGuard } from '../access/require-permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { AccountDeletionOrchestrator } from './account-deletion.orchestrator';
import { asInput, crmActor, decodeCursor, listQuerySchema, pageResult, versionBodySchema } from './crm-http';
import { createAccountBodySchema, linkContactBodySchema, toAccountView, updateAccountBodySchema } from './accounts.dto';
import { toContactView } from './contacts.dto';

/**
 * Account API (`/api/v1/accounts`, RFC-002 §7). Defense in depth: the PDP guard requires the
 * `account.*` permission (layer 1), the service re-checks it with ownership narrowing (layer 2), and
 * RLS scopes every row to the active org+workspace (layer 3). The `:id/contacts` sub-resource manages
 * the Account↔Contact relationship. Delete routes through the host orchestrator (open-Deal guard).
 */
@Controller('accounts')
@UseGuards(RequirePermissionGuard)
export class AccountsController {
  constructor(
    private readonly accounts: AccountService,
    private readonly links: AccountContactService,
    private readonly deletion: AccountDeletionOrchestrator,
  ) {}

  @Get()
  @RequirePermission('account.read')
  async list(@Query() query: unknown) {
    const { limit, cursor } = listQuerySchema.parse(query);
    const rows = await this.accounts.list(crmActor(), asInput({ limit, cursor: decodeCursor(cursor) }));
    return pageResult(rows, limit, toAccountView);
  }

  @Post()
  @RequirePermission('account.create')
  async create(@Body() body: unknown) {
    const input = createAccountBodySchema.parse(body);
    return toAccountView(await this.accounts.create(crmActor(), asInput(input)));
  }

  @Get(':id')
  @RequirePermission('account.read')
  async get(@Param('id') id: string) {
    return toAccountView(await this.accounts.get(crmActor(), id));
  }

  @Patch(':id')
  @RequirePermission('account.update')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion, ...fields } = updateAccountBodySchema.parse(body);
    return toAccountView(await this.accounts.update(crmActor(), id, expectedVersion, asInput(fields)));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('account.delete')
  async archive(@Param('id') id: string, @Body() body: unknown) {
    const { expectedVersion } = versionBodySchema.parse(body);
    await this.deletion.archive(crmActor(), id, expectedVersion);
  }

  @Get(':id/contacts')
  @RequirePermission('account.read')
  async listContacts(@Param('id') id: string) {
    return (await this.links.listContactsForAccount(crmActor(), id)).map(toContactView);
  }

  @Post(':id/contacts')
  @RequirePermission('account.update')
  async link(@Param('id') id: string, @Body() body: unknown) {
    const input = linkContactBodySchema.parse(body);
    await this.links.link(crmActor(), asInput({ accountId: id, ...input }));
    return { ok: true };
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermission('account.update')
  async setPrimary(@Param('id') id: string, @Param('contactId') contactId: string) {
    await this.links.setPrimary(crmActor(), id, contactId);
    return { ok: true };
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermission('account.update')
  async unlink(@Param('id') id: string, @Param('contactId') contactId: string) {
    await this.links.unlink(crmActor(), id, contactId);
  }
}
