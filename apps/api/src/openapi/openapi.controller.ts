import { Controller, Get, Header } from '@nestjs/common';
import { SkipRateLimit } from '../http/rate-limit.decorator';
import { buildOpenApiDocument } from './openapi.builder';
import { API_ROUTES } from './routes';

/** Assembled once at module load — the registry and taxonomy are static. */
const DOCUMENT = buildOpenApiDocument(API_ROUTES);

const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <title>AgentOS Platform Foundation API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

/**
 * Serves the generated OpenAPI 3.1 document and a docs viewer (CLAUDE.md §6). Public and
 * rate-limit-exempt so the contract is always reachable. The viewer loads from a CDN — no npm
 * dependency; a later hardening pass can vendor it.
 */
@Controller()
@SkipRateLimit()
export class OpenApiController {
  @Get('openapi.json')
  document(): Record<string, unknown> {
    return DOCUMENT;
  }

  @Get('docs')
  @Header('content-type', 'text/html')
  docs(): string {
    return DOCS_HTML;
  }
}
