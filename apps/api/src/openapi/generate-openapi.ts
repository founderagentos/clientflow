import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument } from './openapi.builder';
import { API_ROUTES } from './routes';

/**
 * Build-time generator for the committed OpenAPI artifact (CLAUDE.md §6). Pure assembly — no DB, no
 * Nest bootstrap. CI re-runs this and diffs docs/openapi.json to catch an out-of-date contract. Run
 * from the repo root: `pnpm exec tsx apps/api/src/openapi/generate-openapi.ts`.
 */
function main(): void {
  const document = buildOpenApiDocument(API_ROUTES);
  const outPath = join(process.cwd(), 'docs', 'openapi.json');
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${outPath} (${API_ROUTES.length} routes)`);
}

main();
