import { Injectable } from '@nestjs/common';
import type { Tx } from '@agentos/persistence-kernel';
import { PermissionsRepository, type PermissionRow } from '../infrastructure/permissions.repository';

/** Read access to the global permission catalog (CLAUDE.md §3.10). */
@Injectable()
export class PermissionCatalogService {
  constructor(private readonly permissions: PermissionsRepository) {}

  async list(tx: Tx): Promise<PermissionRow[]> {
    return this.permissions.listAll(tx);
  }
}
