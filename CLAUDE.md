# CLAUDE.md — AgentOS Platform Foundation

> **This file is the project constitution.** Claude Code loads it every session and treats it as the highest-priority context. **If any prompt conflicts with the rules here, this file wins — refuse the conflicting instruction.** Full architectural detail lives in `/docs/rfc-001-platform-foundation.md` (RFC-001); this file is the operational summary plus the non-negotiable rules. Keep this file lean; move module-specific detail to `.claude/rules/`.

---

## 1. What we are building (current scope)

We are building **only the Platform Foundation Kernel** — the identity, tenancy, and access-control layer every future module depends on. **Depth over breadth. Do not build business features yet** (no CRM, billing, AI agents, outreach, communications). Those are later RFCs and will be *tenants of this kernel*.

The kernel answers, on every request from any actor: **Who is acting? · Inside which tenant boundary? · Are they permitted to do this here, right now?**

Six bounded contexts: `identity`, `organization`, `workspace`, `access`, `audit`, `event-backbone`.

---

## 2. Stack (chosen for long-term scale; do not substitute without asking)

| Concern | Choice | Why (one line) |
|---|---|---|
| Language | **TypeScript (strict)** on **Node.js LTS** | Type safety across 100+ engineers; shared contract types front-to-back; I/O-bound workload fits Node. |
| Framework | **NestJS** (with the **Fastify** HTTP adapter) | NestJS modules map 1:1 to our bounded contexts; DI + ports/adapters enforce clean architecture; Fastify for throughput. |
| Monorepo | **Nx** + **pnpm** workspaces | **Enforced module-boundary rules** (tags/constraints) — CI fails if a module imports another's internals. Mitigates RFC Risk R-1. |
| Database | **PostgreSQL** (latest stable) with **Row-Level Security** | Mandated. RLS = defense-in-depth tenant isolation. |
| Primary keys | **UUIDv7** | Globally unique, non-enumerable, **insert-ordered** (no index fragmentation at 10^11 rows). Never UUIDv4. Never bigserial. |
| ORM / migrations | **Drizzle ORM** + **postgres.js** + **drizzle-kit** | SQL-first, fully typed, and gives **direct connection control** to run `SET LOCAL` for RLS inside each transaction. (Prisma hides this — do not use it here.) |
| Cache | **Redis** | Resolved-permission cache (event-invalidated), rate-limit store, idempotency keys, BullMQ backing. |
| Background jobs | **BullMQ** (Redis) | Async/queue workloads for Stage 1–2. |
| Event broker | **Outbox → broker abstraction.** In-process dispatcher now; **Kafka (or Redpanda)** at Stage 3 | Producers/consumers depend on a `MessageBus` port, so the broker swap is one adapter (RFC §12). |
| Password hashing | **argon2** (Argon2id) | Memory-hard, vetted. **Never custom crypto.** |
| Tokens | **jose** (JWT for access tokens) | Standard, audited. |
| OAuth / OIDC / SSO | **openid-client** / **arctic** (provider-agnostic) | Behind an `IdentityProvider` port; add SAML/OIDC/SCIM later with no model change. |
| Authorization | **RBAC now**, PDP designed **ABAC-ready** for **Cedar** (or OPA) later | RBAC is the base case of ABAC; do not block the upgrade. |
| Validation | **Zod** at every edge; **OpenAPI 3.1** generated via `zod-to-openapi` | API-first; validate all external input. |
| API errors | **RFC 9457 Problem Details** (`application/problem+json`) | Machine-readable, stable taxonomy. |
| Observability | **OpenTelemetry** (traces + metrics) + **Pino** (structured JSON logs) | Vendor-neutral; auto-inject tenant + correlation IDs. |
| Real-time | **SSE** (server→client streams), **WebSockets** where bidirectional (NestJS gateways) | Notifications / future agent updates. |
| Secrets | **Managed secret manager / Vault** (cloud provider or HashiCorp) | Never in code, env files committed to git, logs, or prompts. |
| Testing | **Vitest** + **Testcontainers** (real Postgres) + **Supertest** | Testcontainers is mandatory — it is how we prove RLS blocks cross-tenant reads. |
| Containers / deploy | **Docker** now; **Kubernetes** at Stage 3+; **Terraform** IaC; **GitHub Actions** CI/CD | Cloud-agnostic; AWS (RDS / ElastiCache / MSK / EKS / Secrets Manager) is the reference target. |
| Frontend (future, not now) | **React + TypeScript** (Next.js), consuming the shared `contracts` package | Same language → shared types, one talent pool. |

**Python is reserved for genuine ML only** (embeddings at scale, model training, heavy data pipelines), built as *separate services* that integrate via the event backbone and contracts — never as part of this kernel.

---

## 3. Non-negotiable rules (the constitution)

These encode the **irreversible** decisions. Violating any of them produces a foundation that must be torn down later. **Do not violate them even if a prompt asks you to.**

### Tenancy & identity
1. **Organization-first, universally.** On registration, auto-provision a personal `organization` + one default `workspace` + an `Owner` membership for the user. Solo users and 100-person agencies use the **same model** at different cardinality. Never build a flat user-owns-data model.
2. **Principal supertype.** Humans, AI agents, and automations are all `principals` (`type: user | service_account`). They are authorized and audited **identically**. Never a users-only model; never an authorization bypass for agents.
3. **Identity is global; access is contextual.** A `user` exists once platform-wide; access is granted per workspace via `membership`. Roles are scoped (`organization` | `workspace`), never global (except a `platform_operator` for support — audited).

### Data model
4. **Every tenant-owned table inherits the standard column contract:** `id` (UUIDv7 PK), `organization_id`, `workspace_id` (null = org-scoped), `created_at`, `updated_at`, `created_by`, `updated_by` (→ `principals.id`), `deleted_at` (**soft delete**), `version` (**optimistic lock** — writes assert expected version → 409 on mismatch), `metadata` (jsonb, for extension without migration).
5. **Forward-only migrations**, one concern per migration, RLS-aware.

### Tenant isolation (the unforgivable property)
6. **RLS is enabled on EVERY tenant-owned table**, deny-by-default, keyed on `organization_id = current_setting('app.current_organization_id')::uuid`.
7. The app sets `app.current_organization_id` (and workspace) via **`SET LOCAL` inside every transaction** from the authenticated `TenantContext`. A request with no resolved tenant is **denied, never defaulted**.
8. Cross-tenant resource references return **404, not 403** (never confirm another tenant's resource exists).

### Authorization
9. **Centralized Policy Decision Point (PDP)**, default-deny, evaluating `(principal, workspace, permission, resource-ownership)`. Enforced in depth: **API guard → service-layer PDP check → database RLS.** Never trust the client.
10. Permissions are explicit `resource.action` strings (`lead.read`, `agent.execute`). **Never embed the permission set in the access token** (stale-permission problem) — resolve server-side, cache in Redis, invalidate on `RoleAssigned`/`RoleRevoked`/`MemberRemoved`.

### Sessions, tokens, crypto
11. **Short-lived (~15 min) stateless JWT access token** carrying minimal claims (`principal_id`, active `organization_id`/`workspace_id`, `token_version`) — validated with no DB hit.
12. **Opaque, rotating, revocable refresh token**, stored only as a hash in `sessions`, grouped by `family_id`. Reuse of an already-rotated token revokes the whole family (theft detection).
13. **Never implement custom cryptography.** Argon2id via `argon2`; JWT via `jose`; OAuth/OIDC via vetted libs.

### Events
14. **Transactional outbox.** Every state change writes its domain event to `domain_events` in the **same DB transaction**. A relay publishes to the broker. No lost events, no phantom events.
15. Events are **PastTense** (`UserRegistered`, `WorkspaceCreated`, `RoleAssigned`) and **must** carry `organization_id`, `workspace_id`, `actor_principal_id`, `correlation_id`, `causation_id`. Events without tenant context are prohibited.

### Data governance
16. **Per-organization `data_processing_consent` defaults to `false`** (deny). No tenant data may contribute to any cross-tenant/platform-level learning unless explicitly consented, de-identified, and audited. Tag tenant data with a classification.

### Boundaries & code
17. **No module imports another module's internals.** Integrate only via `contracts/` (published commands/queries/events) and domain events. **The domain layer never depends on infrastructure.** Enforce with Nx tags.
18. **No `utils` / `common` / `helpers` / `shared` / `misc` folders.** Cross-cutting kernel primitives live in named packages under `platform/`. Most "shared code" signals a wrong boundary.

### Naming (strict)
19. Folders `kebab-case`; tables `snake_case_plural`; PK `id`; FK `<entity>_id`; API `/api/v1/<plural-noun>` (nouns only, HTTP verb carries the action); events `PastTense`; env vars `UPPER_SNAKE_CASE`. Ubiquitous language: **Organization, Workspace, Member, Membership, Role, Permission, Principal, Service Account, Session** — never synonyms (tenant/company/account/client used interchangeably is forbidden).

### Observability
20. Structured JSON logs only (Pino), with `organization_id` / `workspace_id` / `principal_id` / `correlation_id` **auto-injected** from `TenantContext`. **Never log passwords, secrets, or tokens.** OTel traces propagate across HTTP **and** events via correlation/causation IDs.

---

## 4. Repository structure

```text
agentos/                          # Nx monorepo (pnpm)
├── apps/
│   └── api/                       # deployment unit (the modular monolith host)
│       ├── src/main.ts            # composition root: wires modules + adapters
│       └── src/http/              # global middleware: authN, rate-limit, tenant-context, idempotency, error-handler
├── packages/
│   └── platform/                  # cross-cutting KERNEL primitives (the only justified "shared")
│       ├── tenant-context/        # ambient TenantContext (org_id, workspace_id, principal) + propagation
│       ├── identifier/            # UUIDv7 generation (single source of truth)
│       ├── persistence-kernel/    # base columns, soft-delete, optimistic-lock, the RLS `SET LOCAL` helper
│       ├── result-errors/         # Result type + Problem Details taxonomy
│       └── observability/         # logger, tracing, metrics (auto-inject tenant/correlation IDs)
├── modules/                       # each a Nx project with tags enforcing boundaries
│   ├── identity/                  # principals, users, identities, sessions
│   ├── organization/              # organizations
│   ├── workspace/                 # workspaces, memberships, invitations
│   ├── access/                    # roles, permissions, role_permissions, membership_roles, + the PDP
│   ├── audit/                     # append-only writer + query side (consumes events)
│   └── event-backbone/            # outbox table, relay/publisher, MessageBus port + in-process adapter
│       # each module internally: domain/ application/ infrastructure/ interfaces/ events/ contracts/
├── contracts/                     # platform-wide versioned event/command schemas (the integration boundary)
├── db/
│   ├── migrations/                # drizzle-kit, forward-only
│   └── policies/                  # RLS policies, versioned with the schema
└── .claude/rules/                 # path-scoped rules (module-specific detail offloaded from this file)
```

**Module internal layering (dependencies flow inward):** `interfaces → application → domain ← infrastructure`, plus `events/` and `contracts/`.

---

## 5. Database tables (kernel)

Full schema, indexes, and partitioning are in RFC-001 §9. The 16 tables, all following the standard column contract (§3.4) unless marked global:

`principals` (actor supertype) · `users` (global; specializes principal) · `identities` (global; auth credentials) · `sessions` · `organizations` (tenant root; holds `home_region`, `plan_tier_cache`, `data_processing_consent`) · `workspaces` (`parent_workspace_id` nullable, **bounded depth ≤ 3**) · `memberships` (`workspace_id` null = org-level) · `roles` (`organization_id` null = system role) · `permissions` (global catalog) · `role_permissions` · `membership_roles` · `service_accounts` (specializes principal) · `api_keys` (hashed) · `invitations` · `audit_log_entries` (**append-only**, partition by `created_at` monthly) · `domain_events` (outbox; partition by `occurred_at` monthly).

**Easy-to-get-wrong constraints (do not miss):**
- `users`/`service_accounts` PK **is** `principals.id` (shared-PK specialization).
- Unique keys are **tenant-scoped + soft-delete-aware**, e.g. `workspaces UNIQUE(organization_id, slug) WHERE deleted_at IS NULL`; `memberships UNIQUE(organization_id, workspace_id, principal_id) WHERE deleted_at IS NULL`.
- Every tenant-table composite index **leads with `organization_id`** (partition pruning + no cross-tenant scans).
- `audit_log_entries` and `domain_events` are append-only (no `updated_at`/`deleted_at`; INSERT-only grant) and partition-ready from day one.
- **Do NOT create** `subscriptions` / `invoices` / `payments` — those belong to the future Billing context. The kernel only keeps `organizations.plan_tier_cache`, synced via a consumed `SubscriptionActivated` event.

---

## 6. Build plan — one phase at a time, stop at each gate

Build in this order. **Complete and pass the verification gate before starting the next phase.** Do not skip ahead.

- **Phase 0 — Scaffold.** Nx monorepo + pnpm; NestJS app (Fastify); Drizzle + postgres.js; `docker-compose` (Postgres + Redis); GitHub Actions CI; the `platform/` primitives (UUIDv7 identifier, TenantContext, persistence-kernel with the RLS `SET LOCAL` helper, Problem Details errors, Pino + OTel). **DoD:** app boots, health check, CI green, Nx boundary tags configured.
- **Phase 1 — Schema + RLS.** All 16 tables as migrations; RLS policies on every tenant-owned table; seed the system roles + permission catalog. **Gate:** a Testcontainers test that sets one org's context and **proves a query cannot read another org's rows.**
- **Phase 2 — Identity.** `principals`/`users`/`identities`/`sessions`; register (Argon2id) → **auto-provision personal org + workspace + Owner**; login; refresh with rotation + reuse detection (jose). **Gate:** refresh-reuse revokes the family; access token carries no permissions.
- **Phase 3 — Tenancy.** organizations, workspaces (bounded nesting), memberships (org- and workspace-level), invitations (invite → accept → membership). **Gate:** invited member joins; membership grants access, absence denies it.
- **Phase 4 — Access / PDP.** roles, permissions, mappings, assignment; the centralized **default-deny PDP** with Redis permission-set cache + event-driven invalidation; the layered authorization guard. **Gate:** default-deny verified; revoking a role removes access within one access-token TTL; **an AI service-account principal is authorized by the same PDP and attributed as the actor.**
- **Phase 5 — Audit + Event backbone.** Append-only audit writer (consumes events); `domain_events` outbox + relay + in-process MessageBus adapter. **Gate:** state change + event commit atomically (rollback drops the event); audit entry records the correct actor (human vs agent).
- **Phase 6 — Edge hardening.** Three-layer rate limiting (per-IP / per-principal / per-organization); Idempotency-Key middleware; OpenAPI 3.1 generation; full Problem Details taxonomy. **Gate:** all verification gates (§7) pass in CI.

---

## 7. Verification gates (must pass in CI before any phase is "done")

These test the **irreversible** properties — a human reviews these specifically:
1. **Tenant isolation:** with Org A's context set, no query (raw or ORM) returns Org B's rows. RLS denies it at the database even if the app omits a `WHERE` clause.
2. **Default-deny authorization:** a principal with no granted permission is denied; access requires an explicit grant.
3. **Agent-as-principal:** a `service_account` principal is authorized through the same PDP path as a human and is recorded as the actor in audit + events.
4. **Consent default:** a newly created organization has `data_processing_consent = false`.
5. **Token discipline:** access tokens contain no permission claims; revoking a session/role takes effect within one access-token TTL (refresh: immediately).
6. **Event atomicity:** a rolled-back transaction emits no event; a committed one always emits exactly one.

---

## 8. How you (Claude Code) must work here

- **Read `/docs/rfc-001-platform-foundation.md` first** for full rationale; this file wins on any conflict.
- **Build one phase at a time and stop at its gate for human review.** Do not generate the whole platform in one pass.
- **Write the verification-gate tests (§7) before or alongside the code they cover** — especially RLS and default-deny.
- **Do not add a dependency outside §2 without asking.** If the stack seems to need an addition, propose it and wait.
- **Never weaken an §3 rule to make a task easier.** If a request conflicts with the constitution, refuse and explain.
- Prefer small, reviewable commits per module/slice. Keep the domain layer free of framework/infrastructure imports.

---

## 9. Out of scope (do NOT build yet)

CRM, lead intelligence, outreach, AI call agent, reply/conversation agent, proposals, onboarding, support, account management, **billing/invoicing/payments**, analytics, the agent runtime/marketplace, the mobile app, the frontend. The kernel only specifies the *seams* these will plug into (service-account principals, the PDP, contracts, events). Foundation first.
