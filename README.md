# AgentOS — Platform Foundation Kernel

The identity, tenancy, and access-control kernel every future module depends on.
Governance lives in [CLAUDE.md](CLAUDE.md) (the constitution); full rationale in
[docs/rfc-001-platform-foundation.md](docs/rfc-001-platform-foundation.md).

## Prerequisites

- **Node.js ≥ 20** (22+ recommended), **pnpm 9** (`corepack prepare pnpm@9 --activate`)
- **Docker** — required for the local Postgres/Redis and for Testcontainers integration tests

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d        # Postgres 18 + Redis 7
```

## Develop

```bash
pnpm serve                  # boot the API → http://localhost:3000/api/v1/health
pnpm build                  # nx run-many -t build
pnpm lint                   # incl. @nx/enforce-module-boundaries (cross-module imports fail)
pnpm typecheck
pnpm test
```

## Layout

```
apps/api                    # NestJS (Fastify) deployment unit — composition root + edge
packages/platform/*         # kernel primitives: identifier, tenant-context,
                            #   persistence-kernel, result-errors, observability
modules/*                   # bounded contexts: identity, organization, workspace,
                            #   access, audit, event-backbone (built per phase)
contracts                   # versioned event/command schemas (the integration boundary)
db/                         # migrations + RLS policies (Phase 1)
```

Module boundaries are enforced by Nx tags (`type:` / `scope:`): a module may depend only on
`type:platform` and `type:contracts`, never on another module's internals.

## Build status

**Phase 0 (Scaffold) complete.** Phases 1–6 proceed one at a time, stopping at each
verification gate (CLAUDE.md §6/§7).
