import './tracing';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadConfig } from './config/env';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.flushLogs();
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // Edge seam: ensure every request/response carries a correlation id (CLAUDE.md §3.20).
  // Future seams added in their phases: authN, rate-limit, tenant-context resolution, idempotency.
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(fastifyCookie);
  fastify.addHook('onRequest', (request, reply, done) => {
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? randomUUID();
    void reply.header('x-correlation-id', correlationId);
    done();
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

void bootstrap();
