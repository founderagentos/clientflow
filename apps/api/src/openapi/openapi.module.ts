import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller';

/** Hosts the OpenAPI document + docs viewer endpoints (CLAUDE.md §6). */
@Module({ controllers: [OpenApiController] })
export class OpenApiModule {}
