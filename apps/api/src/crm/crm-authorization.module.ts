import { Global, Module } from '@nestjs/common';
import { AUTHORIZATION } from '@agentos/authorization';
import { AccessFeature } from '../access/access.feature';
import { CrmAuthorizationAdapter } from './crm-authorization.adapter';

/**
 * Binds the platform `AUTHORIZATION` port to the PDP-backed {@link CrmAuthorizationAdapter}, globally,
 * so CRM module services resolve it by token without importing the host (same pattern as the global
 * `DATABASE`/`OUTBOX` tokens). Imports `AccessFeature` (the single configured access module instance)
 * for the `PolicyDecisionPoint`.
 */
@Global()
@Module({
  imports: [AccessFeature],
  providers: [{ provide: AUTHORIZATION, useClass: CrmAuthorizationAdapter }],
  exports: [AUTHORIZATION],
})
export class CrmAuthorizationModule {}
