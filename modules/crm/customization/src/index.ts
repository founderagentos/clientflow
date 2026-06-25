import 'reflect-metadata';
import { Module } from '@nestjs/common';

/**
 * The CRM `customization` bounded context (RFC-002 §3.1) — tenant schema extension: typed
 * CustomFieldDefinition plus Tag/taggables. Empty in Phase 0 (scaffold only): schema lands in
 * Phase 1. Custom fields are inline validated `jsonb` governed by definitions — **not** EAV
 * (§11) — and distinct from the kernel `metadata` jsonb. Integrate only via `@agentos/contracts`
 * and domain events.
 */
@Module({})
export class CrmCustomizationModule {}
