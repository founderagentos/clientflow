import { defineConfig } from 'drizzle-kit';

/**
 * Forward-only migrations (CLAUDE.md §3.5). Module schemas live in each module's
 * infrastructure layer as `*.schema.ts`; migrations are emitted to db/migrations and RLS
 * policies are versioned alongside in db/policies (added in Phase 1).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['modules/**/src/**/*.schema.ts'],
  out: 'db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  },
  strict: true,
  verbose: true,
});
