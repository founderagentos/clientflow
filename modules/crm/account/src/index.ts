import 'reflect-metadata';
import { Module } from '@nestjs/common';

/**
 * The CRM `account` bounded context (RFC-002 §3.1) — Account + Contact + the `account_contacts`
 * relationship core (the durable book of business). Empty in Phase 0 (scaffold only): schema lands
 * in Phase 1, the relationship/erasure logic in Phase 2. NOTE the naming trap (§2.1): an Account is
 * a business *inside* a tenant, never the kernel `Organization`. Integrate only via
 * `@agentos/contracts` and domain events (§3.3 / CLAUDE.md §17).
 */
@Module({})
export class CrmAccountModule {}
