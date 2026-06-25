# RFC-002 — CRM Core Context

> **Status:** Proposed · **Supersedes:** none · **Depends on:** RFC-001 (Platform Foundation Kernel)
> **Scope:** The first *product* bounded context. A pure **tenant of the kernel** — it introduces **no new authorization, isolation, identity, or event mechanism.** It plugs into the seams RFC-001 already cut: `TenantContext`, the centralized PDP, the transactional outbox, the audit consumer, and the `contracts/` integration boundary.
>
> **This RFC does not amend the constitution.** Every rule in `CLAUDE.md §3` holds verbatim. CRM-specific operating detail is offloaded to `.claude/rules/crm.md`; this document is the design of record.

---

## 1. Objectives (Architectural Goals)

**Primary goal.** Establish the durable *book of business* (Accounts, Contacts) and the *sales process* (Leads → Deals across Pipelines), plus the engagement record (Activities, Tasks) and tenant-level extensibility (Custom Fields, Tags) — as the spine every later product context attaches to.

**Goals, ranked.**
1. **Be a flawless kernel tenant.** Every table inherits the §3.4 column contract; RLS on every table; every mutation routes through the PDP and emits an outbox event. Zero constitutional exceptions. If CRM needs an exception, the *kernel* is wrong — escalate, don't bypass.
2. **AI-ready without building AI.** Emit a rich, tenant-scoped, correlation-carrying domain-event stream. The future Agent Runtime, Outreach, Account-Management, and Analytics contexts are *consumers* of this stream — they are not coded here, but the events they will need are designed here, now.
3. **Production scale from day one of design.** The writeup commits to "millions of leads without performance degradation." That is a design constraint, not marketing: keyset pagination, org-leading composite indexes, denormalized board counters, async chunked import, partition-readiness.
4. **Clean funnel separation.** Unqualified, duplicate-prone top-of-funnel data (Leads) is structurally isolated from the curated relational core (Accounts/Contacts/Deals), so noise never pollutes the book of business.
5. **Future-extractable.** `lead`, `account`, `deal`, `activity`, `customization` must each be liftable into an independent service with the outbox and `contracts/` already in place — the same extraction path RFC-001 §17 defines for the kernel.

**Explicit non-goals (belong to later RFCs).**
- **Lead discovery / scraping / enrichment / AI scoring** → RFC-003 (Lead Intelligence). It *writes leads through CRM contracts* and reads CRM events; it does not live here. The §3.16 consent flag becomes load-bearing there.
- **Outreach execution, the call agent, the reply agent** → Communication RFCs. They *log Activities* back into CRM via contracts.
- **Proposals, e-sign, onboarding, billing/invoicing, analytics dashboards, the agent runtime/marketplace** → their own RFCs.

---

## 2. Domain Analysis

### 2.1 Ubiquitous language (strict — §19 applied to CRM)

| Term | Definition | **Reserved — do not confuse with** |
|---|---|---|
| **Lead** | An unqualified prospect: a discovered/imported business or person not yet validated. Disposable, mergeable, may be a duplicate. Converted **exactly once**. | A `Contact` (qualified). A kernel `Member`/`Principal`. |
| **Account** | A **business the tenant sells to or serves** — the durable customer/prospect entity. | **The kernel `Organization`** (which is *the tenant itself*). This collision is the single most dangerous naming trap in the platform. An Account is *inside* an Organization's tenant boundary. |
| **Contact** | A **person** at an Account (or floating). The durable people entity. | A kernel `User`/`Principal` (a platform actor who logs in). A Contact never authenticates. |
| **Deal** | A revenue opportunity for a specific Account, moving through a Pipeline. The unit of forecasting. | A `Lead` (pre-conversion). "Opportunity"/"Job" are **forbidden synonyms** — the word is **Deal**. |
| **Pipeline / Stage** | A workspace-configurable ordered set of Stages a Deal moves through. | The kernel's build "phases." |
| **Activity** | An entry in the engagement timeline (note, call, email, meeting, system event). The **business** record of what happened. | The kernel **`audit_log_entries`** (the immutable *security* record). They are different tables with different guarantees. |
| **Task** | A future, assignable, due-dated action item. | An Activity (which is past-tense). |
| **Tag / Custom Field** | Tenant-defined classification and typed schema extension. | The kernel `metadata` jsonb (reserved for true ad-hoc, non-queryable extension). |

**Forbidden interchangeable use:** company / client / customer / firm for **Account**; person / user for **Contact**; opportunity / job for **Deal**. One concept, one word, everywhere — code, tables, API, events, UI.

### 2.2 Aggregates and invariants

- **Lead** — root. Lifecycle `new → working → qualified | unqualified`. Carries raw captured data + normalized dedup keys (`email_normalized`, `phone_e164`, `domain`). Invariants: convertible only from a non-terminal status; conversion is **idempotent and one-shot** (`converted_at` set once, records the produced `account_id` / `contact_id` / `deal_id`); a merged lead is soft-deleted with `merged_into_lead_id` set and its Activities/Tasks repointed to the survivor.
- **Account** — root. Holds firmographics (name, domain, industry, size band, address). Has many Contacts (via `account_contacts`, with `is_primary` and relationship role). Soft-deletable; deletion is blocked while open Deals exist (domain guard, not a DB cascade).
- **Contact** — root. Belongs to ≥0 Accounts; ≤1 primary. Holds PII (name, emails, phones). Supports a **GDPR/DPDP erasure** path distinct from soft delete (§8.4).
- **Deal** — root. Belongs to exactly one Pipeline and sits in exactly one Stage at a time. Carries `amount` + `currency`, `expected_close_date`, `owner_principal_id`. Stage transitions are **explicit domain operations** guarded by pipeline rules; reaching a `won`/`lost` Stage is terminal and requires a `close_reason`. Every transition appends an immutable `deal_stage_history` row (for velocity/forecasting).
- **Pipeline / Stage** — Stage carries `position`, `probability` (forecast weight), and a `category` (`open | won | lost`). A workspace's first Pipeline is seeded to match the writeup's default stages.
- **Activity** — the unified timeline. `type ∈ {note, call, email, meeting, task_event, system}`. **System** activities (e.g. `StageChanged` rendered for humans) are immutable; **user-authored** activities (notes) are editable under optimistic lock. Polymorphic subject `(subject_type, subject_id)`.
- **Task** — `assignee_principal_id`, `due_at`, `status ∈ {open, done, cancelled}`, optional subject link. Overdue detection is event-driven (a scheduled relay emits `TaskOverdue`), not a hot-path query.
- **CustomFieldDefinition** — per-workspace typed schema (`text | number | date | select | multiselect | boolean`), with select options and validation. Governs the inline `custom_fields jsonb` on each business entity.
- **Tag** — workspace-scoped label; polymorphic M:N via `taggables`.

### 2.3 Scoping rule (kernel-aligned)

All CRM **business records** (lead, account, contact, deal, activity, task) are **workspace-scoped** (`workspace_id NOT NULL`). Configuration (pipeline, stage, tag, custom-field definition) defaults workspace-scoped but uses the kernel's `workspace_id = null ⇒ org-scoped` convention so org-wide shared config can be promoted later **without migration**. Cross-workspace reporting is **not** an OLTP read here — it is an Analytics-context concern fed by events. You operate inside your active workspace; seeing another's data is a context switch (deferred, per Phase 3), not a wider query.

---

## 3. System Boundaries

### 3.1 Modules (each an Nx project with boundary tags)

```
modules/crm/
├── lead/            # Lead aggregate, dedup keys, merge, conversion source
├── account/         # Account + Contact + account_contacts (relationship core)
├── deal/            # Pipeline, Stage, Deal, deal_stage_history (the process)
├── activity/        # Activity timeline + Task
└── customization/   # CustomFieldDefinition + Tag (tenant schema extension)
```

Each module keeps the kernel's internal layering: `interfaces → application → domain ← infrastructure`, plus `events/` and `contracts/`.

### 3.2 Host orchestrators (in `apps/api`, the composition root)

Cross-context operations that must be **atomic** are composed at the host, exactly as `RegistrationOrchestrator` was in RFC-001 — never by one module reaching into another.

- **`LeadConversionOrchestrator`** — in one DB transaction: create/match Account → create/match Contact → create Deal → mark Lead converted → write all four events to the outbox. One transaction, all-or-nothing (kernel §14).
- **`BulkImportOrchestrator`** — accepts a validated import job, fans rows to a BullMQ worker, applies per-row dedup, and is **idempotent under the Phase-6 Idempotency-Key** (re-submitting the same file + key is a no-op).

### 3.3 Dependency rules (kernel §17, non-negotiable)

- Modules reference each other **by UUIDv7 id only**, resolved through published `contracts/` queries (e.g. `account.GetAccountById`) — **never** by importing another module's domain/infrastructure. Nx tags fail CI on violation.
- The domain layer imports **no** framework or infrastructure.
- DB-level foreign keys *are* permitted where they enforce integrity within the single Stage-1 database (e.g. `deals.account_id → accounts.id`), but they are an *infrastructure* detail: code still integrates only via contracts. On future extraction (§12), each FK becomes a contract query + eventual-consistency reference; the outbox makes that swap mechanical.

### 3.4 Relationship to the kernel (consumed seams)

| Kernel seam | How CRM uses it |
|---|---|
| `platform/tenant-context` | Every transaction `SET LOCAL`s org + workspace; no record is written or read without it. |
| `access` PDP | Every command checks a `resource.action` permission **and** resource-ownership (§8.2). |
| `event-backbone` outbox | Every state change writes its event in the same transaction. |
| `audit` | Consumes CRM events; records actor (human vs `service_account`) truthfully. |
| `platform/identifier` | UUIDv7 for all PKs. |
| `platform/persistence-kernel` | Standard columns, soft delete, optimistic lock, the RLS `SET LOCAL` helper. |
| `access` permission catalog | CRM **adds** its `resource.action` permissions via a seed migration (§8.1). |

---

## 4. Data Flow (representative paths)

**A. Create lead (manual).** `POST /api/v1/leads` → Zod validate → PDP `lead.create` → open tx (`SET LOCAL` org+ws) → insert `leads` (+ normalized dedup keys) → write `LeadCreated` to outbox → commit → relay publishes → audit records actor. 201 + `Location`.

**B. Bulk import.** `POST /api/v1/imports` (CSV + `Idempotency-Key`) → create `import_jobs` row (`status=pending`) → enqueue BullMQ → worker streams rows in chunks, per row: normalize → dedup-match → insert-or-skip-or-merge → increments job counters → on finish emits `LeadImported{created,merged,skipped,failed}`. Re-POST with same key returns the existing job (no re-run).

**C. Lead → Deal conversion.** `POST /api/v1/leads/{id}/conversion` → PDP `lead.convert` → `LeadConversionOrchestrator` opens one tx → match-or-create Account → match-or-create Contact (+ `account_contacts`) → create Deal in the workspace's default Pipeline/first open Stage → set `leads.converted_at` + produced ids → outbox: `AccountCreated?`, `ContactCreated?`, `DealCreated`, `LeadConverted` → commit. Replaying on an already-converted lead returns the prior result (one-shot invariant).

**D. Stage change (Kanban drag).** `POST /api/v1/deals/{id}/stage-transitions {to_stage_id, expected_version}` → PDP `deal.transition` + ownership → load Deal, assert `version` (409 on mismatch) → domain guard validates transition (e.g. cannot skip into `won` without `close_reason`) → update Deal stage + bump `version` → **append** `deal_stage_history{from,to,entered_at,duration_in_prev}` → outbox `DealStageChanged` (+ `DealWon`/`DealLost` if terminal) → commit. The Analytics context later derives stage velocity purely from this event + history.

**E. Read: pipeline board.** `GET /api/v1/pipelines/{id}/board` → returns Stages with **denormalized deal counts and summed amount per stage** (maintained via events / counter table), so the board never runs `COUNT(*)`/`SUM()` over millions of rows on the hot path.

**F. Read: filtered lead list.** `GET /api/v1/leads?status=working&tag=...&cursor=...&limit=50` → **keyset** pagination on `(organization_id, workspace_id, created_at, id)`; filters bounded by an allow-listed DSL; custom-field filters hit GIN/expression indexes on the inline `custom_fields jsonb`.

---

## 5. Folder Structure (one module shown; others identical)

```text
modules/crm/deal/
├── domain/
│   ├── deal.aggregate.ts            # invariants, stage-transition guards (no infra imports)
│   ├── pipeline.aggregate.ts
│   ├── stage.value-object.ts
│   └── deal-stage-transitioned.event.ts
├── application/
│   ├── commands/ (create-deal, transition-stage, win-deal, lose-deal, assign-deal)
│   ├── queries/  (get-deal, list-deals, get-board)
│   └── ports/    (DealRepository, MessageBus)         # interfaces only
├── infrastructure/
│   ├── drizzle/  (schema, repository impl, RLS-aware tx)
│   └── outbox/   (event writer)
├── interfaces/
│   └── http/     (controllers, Zod DTOs → OpenAPI, Problem Details mapping)
├── events/       (internal event handlers, e.g. stage-counter projector)
└── contracts/    (PUBLISHED: GetDealById query + DealCreated/DealStageChanged/DealWon/DealLost schemas)
```

No `utils`/`common`/`helpers`/`shared`/`misc` (§18). Cross-cutting CRM primitives, if any genuinely emerge, become a named package under `platform/` — but the expectation is **none** are needed; most "shared CRM code" signals a wrong boundary.

---

## 6. Database Design

**14 tables**, all under the §3.4 standard column contract and RLS unless marked. RLS policy on every table enforces **org *and* active workspace**:

```sql
-- applied to every CRM business table
CREATE POLICY tenant_isolation ON <table>
  USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (workspace_id IS NULL
         OR workspace_id = current_setting('app.current_workspace_id')::uuid)
  );
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
```

### 6.1 Tables

| Table | Purpose | Notable columns (beyond the standard contract) |
|---|---|---|
| `leads` | top-of-funnel prospects | `status`, `source`, `name`, `email`, `email_normalized`, `phone_e164`, `domain`, `score` (nullable; written by RFC-003), `owner_principal_id`, `converted_at`, `converted_account_id`, `converted_contact_id`, `converted_deal_id`, `merged_into_lead_id`, `custom_fields jsonb` |
| `accounts` | customer/prospect businesses | `name`, `domain`, `industry`, `size_band`, `address jsonb`, `owner_principal_id`, `custom_fields jsonb` |
| `contacts` | people | `first_name`, `last_name`, `emails jsonb`, `phones jsonb`, `primary_email_normalized`, `title`, `owner_principal_id`, `erased_at`, `custom_fields jsonb` |
| `account_contacts` | Account ↔ Contact M:N | `account_id`, `contact_id`, `relationship_role`, `is_primary` |
| `pipelines` | configurable pipelines | `name`, `is_default` |
| `pipeline_stages` | ordered stages | `pipeline_id`, `name`, `position`, `probability`, `category (open\|won\|lost)` |
| `deals` | revenue opportunities | `account_id`, `primary_contact_id`, `pipeline_id`, `stage_id`, `amount`, `currency`, `expected_close_date`, `owner_principal_id`, `close_reason`, `closed_at`, `custom_fields jsonb` |
| `deal_stage_history` | **append-only** transitions | `deal_id`, `from_stage_id`, `to_stage_id`, `entered_at`, `duration_in_previous_seconds`, `actor_principal_id` — *no `updated_at`/`deleted_at`; INSERT-only grant; partition-ready by `entered_at` monthly* |
| `activities` | engagement timeline | `subject_type`, `subject_id`, `type`, `body jsonb`, `is_system` (immutable when true), `occurred_at` — *partition-ready by `occurred_at` monthly* |
| `tasks` | follow-ups | `subject_type`, `subject_id`, `assignee_principal_id`, `title`, `due_at`, `status`, `completed_at` |
| `tags` | labels | `name`, `color` |
| `taggables` | Tag ↔ entity M:N | `tag_id`, `taggable_type`, `taggable_id` |
| `custom_field_definitions` | typed tenant schema | `entity_type`, `key`, `label`, `data_type`, `options jsonb`, `is_required`, `validation jsonb` |
| `import_jobs` | bulk import tracking | `idempotency_key`, `status`, `total_rows`, `created_count`, `merged_count`, `skipped_count`, `failed_count`, `error_report jsonb` |

### 6.2 Easy-to-get-wrong constraints (do not miss)

- **Every composite index leads with `organization_id`** (partition pruning, no cross-tenant scan) — kernel §5.
- **Unique keys are tenant-scoped + soft-delete-aware**, e.g. `pipelines UNIQUE(organization_id, workspace_id, name) WHERE deleted_at IS NULL`; `tags UNIQUE(organization_id, workspace_id, name) WHERE deleted_at IS NULL`.
- **No hard unique on contact/lead email.** Real import data is messy and legitimately duplicated; a hard unique would reject good imports. Dedup is a *signal* (`email_normalized`, `phone_e164`, `domain` + a matching service), **not** a constraint. Per-tenant strict-unique is an opt-in policy, later.
- **`deal_stage_history` and the `is_system=true` slice of `activities` are append-only** — no update/delete grant; this is what makes velocity and the human-readable timeline trustworthy.
- **`custom_fields` is inline `jsonb`, governed by `custom_field_definitions` — not EAV.** (Rationale in §11.) GIN-index each entity's `custom_fields`; add expression indexes on hot per-tenant fields as signals appear.
- **Polymorphic `subject_type/subject_id` (activities, taggables) gets a composite index `(organization_id, subject_type, subject_id)`** and is validated at the application edge (the referenced row must exist in-tenant).
- **Conversion pointers on `leads` are write-once.** Enforce in the domain; a re-conversion returns the existing ids.

### 6.3 Index, query, partition, scaling strategy

- **Index.** Board: `deals(organization_id, workspace_id, pipeline_id, stage_id) WHERE deleted_at IS NULL`. Lead list/keyset: `leads(organization_id, workspace_id, created_at, id)`. Dedup: `leads(organization_id, email_normalized)`, `leads(organization_id, phone_e164)`. Ownership filter: partial indexes on `owner_principal_id`. GIN on `custom_fields` and on `taggables`.
- **Query.** **Keyset (cursor) pagination everywhere** — never `OFFSET` at scale. Board counts come from a **maintained counter** (event-driven projection or a small `pipeline_stage_counters` table), not live aggregation. Heavy analytics never run on the OLTP path — they consume events in the Analytics context.
- **Partition.** `deal_stage_history` and `activities` are **partition-ready by date from day one** (monthly), mirroring `audit_log_entries`/`domain_events`. **Activation is deferred until real traffic signals** — consistent with the Phase-5 decision. The largest-tenant `leads` table is a candidate for hash-partition by `organization_id` at Stage 2+; also deferred.
- **Scaling.** Bulk work is async (BullMQ, chunked, idempotent). Read replicas absorb list/board reads as load grows. The kernel's pool→silo path relocates whale tenants to dedicated DB/region with the identical schema (data movement, not redesign).

---

## 7. API Design

**Conventions (kernel §19):** `/api/v1/<plural-noun>`, nouns only, HTTP verb carries the action; Zod at every edge → OpenAPI 3.1; errors are RFC 9457 Problem Details; optimistic concurrency via `version`/`If-Match` → **409**; size limits → **413/415**; idempotency on unsafe writes; three-layer rate limiting inherited.

| Resource | Endpoints |
|---|---|
| Leads | `GET/POST /leads` · `GET/PATCH/DELETE /leads/{id}` · `POST /leads/{id}/conversion` · `POST /leads/{id}/merges` |
| Imports | `POST /imports` (CSV + `Idempotency-Key`) · `GET /imports/{id}` |
| Accounts | `GET/POST /accounts` · `GET/PATCH/DELETE /accounts/{id}` · `GET /accounts/{id}/contacts` |
| Contacts | `GET/POST /contacts` · `GET/PATCH/DELETE /contacts/{id}` · `POST /contacts/{id}/erasure` (GDPR) |
| Deals | `GET/POST /deals` · `GET/PATCH/DELETE /deals/{id}` · `POST /deals/{id}/stage-transitions` · `POST /deals/{id}/closure` |
| Pipelines | `GET/POST /pipelines` · `GET/PATCH /pipelines/{id}` · `GET /pipelines/{id}/board` · `PUT /pipelines/{id}/stages` (reorder) |
| Activities | `GET/POST /activities` · `PATCH /activities/{id}` (user-authored only) |
| Tasks | `GET/POST /tasks` · `PATCH /tasks/{id}` |
| Tags | `GET/POST /tags` · `DELETE /tags/{id}` · `POST /{entity}/{id}/tags` |
| Custom fields | `GET/POST /custom-fields` · `PATCH/DELETE /custom-fields/{id}` |

**Action-as-resource** (keeps nouns + gives a natural audit record): conversion, merges, stage-transitions, closure, erasure are all *resources you create*, each mapping to an event. Pagination is `?cursor=&limit=` (keyset). Filtering is an **allow-listed** field set — never arbitrary SQL-ish input.

---

## 8. Security Design

### 8.1 Permission catalog (seeded into `access`)

Explicit `resource.action` strings (§3.10), registered via migration:

```
lead.read  lead.create  lead.update  lead.delete  lead.assign
lead.convert  lead.merge  lead.import  lead.export
account.read  account.create  account.update  account.delete  account.assign
contact.read  contact.create  contact.update  contact.delete  contact.erase  contact.export
deal.read  deal.create  deal.update  deal.delete  deal.assign  deal.transition  deal.close
pipeline.read  pipeline.manage
activity.read  activity.create
task.read  task.create  task.update  task.assign
tag.manage  customfield.manage
```

`*.export` and `contact.erase` are **sensitive** — always audited, and gated to elevated roles by default.

### 8.2 Layered enforcement (defense in depth, kernel §9)

1. **API guard** — coarse scope (authenticated, active workspace resolved).
2. **Service-layer PDP** — the specific `resource.action`, **plus resource-ownership**. RFC-001's PDP already takes resource-ownership as an input, so intra-tenant least privilege ("a Salesperson sees only Leads/Deals they own or are assigned") maps directly onto it: the PDP resolves `owner-or-assignee-or-workspace-manager`. **RLS guarantees the tenant boundary; the PDP guarantees who, inside it, may touch this row.**
3. **Database RLS** — the unforgivable backstop. Even a missing `WHERE` cannot cross org or active-workspace.

### 8.3 AI / service-account parity (kernel §2 — and a CRM verification gate)

When the future call agent logs an Activity or the reply agent advances a Deal, it acts as a `service_account` principal, authorized by the **same** PDP path and **attributed as the actor** in audit and events. This is proven *now* with a CRM gate (§13), so the seam is real before any agent exists.

### 8.4 PII, consent, and erasure

- Leads/Contacts hold PII. Each table is tagged with a **data classification** (§3.16); the per-org `data_processing_consent` (default `false`) gates any future contribution to cross-tenant learning — RFC-003 must honor it.
- **Erasure ≠ soft delete.** `POST /contacts/{id}/erasure` purges PII columns (names, emails, phones, `custom_fields` PII) and sets `erased_at`, leaving a tenant-safe tombstone so Deals/history referencing the contact stay structurally valid. Emits `ContactErased`. Downstream contexts must honor it via the event.
- **Export is audited** with the actor, count, and filter — enterprise security reviews will ask for exactly this trail.
- Logs never carry PII/secrets (§20); structured logs auto-inject `organization_id`/`workspace_id`/`principal_id`/`correlation_id` only.

---

## 9. Event Design

All events are **PastTense** and carry `organization_id`, `workspace_id`, `actor_principal_id`, `correlation_id`, `causation_id` (§3.15), written through the outbox atomically with state (§3.14).

| Event | Key payload | First consumers (now → future) |
|---|---|---|
| `LeadCreated` / `LeadUpdated` / `LeadAssigned` / `LeadStatusChanged` | lead snapshot / delta | audit → Analytics, Lead Intelligence |
| `LeadsMerged` | `survivor_id`, `merged_id` | audit → Analytics |
| `LeadConverted` | `lead_id`, `account_id`, `contact_id`, `deal_id` | audit → **Outreach**, Account-Mgmt, Analytics |
| `LeadImported` | counts + `import_job_id` | audit → Analytics |
| `AccountCreated/Updated/Deleted` | account snapshot/delta | audit → Account-Mgmt, Analytics |
| `ContactCreated/Updated/Deleted/Erased` | contact snapshot / erasure flag | audit → Communication, Analytics |
| `DealCreated` / `DealAssigned` | deal snapshot | audit → Analytics |
| `DealStageChanged` | `from_stage`, `to_stage`, `duration` | audit → **Analytics (velocity/forecast)**, Outreach |
| `DealWon` / `DealLost` | `amount`, `close_reason` | audit → **Billing** (won), Analytics |
| `ActivityLogged` | subject + type | audit → **Agent Runtime (memory)**, Account-Mgmt |
| `TaskCreated/Completed/Overdue` | task + due | audit → Notifications |
| `CustomFieldDefined` | definition | audit |

**Domain vs integration events.** All of the above are internal domain events (drive audit + intra-context projections like the board counter). A curated subset is republished as **integration events** to the broker for other contexts — through the same outbox, so atomicity holds. The consumer contexts are *named here but not built here*: this is the AI-ready spine.

---

## 10. Scaling Strategy

- **Writes:** single-row commands are O(1) with the outbox; bulk import is async/chunked/idempotent on BullMQ.
- **Reads:** keyset pagination, org-leading covering indexes, denormalized board counters, GIN/expression indexes for tag/custom-field filters. No live aggregation on the OLTP hot path.
- **Growth:** read replicas for list/board; partition activation (history/activities first) when signals justify; hash-partition `leads` for whale tenants at Stage 2+; pool→silo relocation for the largest tenants (kernel-provided).
- **Offload:** forecasting, cohort, and cross-workspace reporting are **Analytics-context read models built from events**, never queries against CRM OLTP.

---

## 11. Tradeoffs

| Decision | Chosen | Rejected | Why / mitigation |
|---|---|---|---|
| Custom fields | **Inline validated `jsonb`** governed by definitions | EAV (`custom_field_values` rows) | EAV multiplies row count (millions of leads × N fields) and wrecks scan/index plans. jsonb + GIN + expression indexes scales; loses some relational elegance — accepted. |
| Lead modeling | **Split Lead from Account/Contact/Deal** | One "contacts" table for everything | Keeps top-of-funnel noise out of the book of business; cost is conversion complexity, contained in one host orchestrator. |
| Conversion | **Single-tx host orchestrator** | Choreographed saga across modules | Stage-1 single DB → atomicity is free and simpler; saga is the Stage-3 swap once modules are services. Same call as RFC-001's registration. |
| Cross-module refs | **DB FKs + contracts** | FKs everywhere with direct imports / no FKs at all | FKs give integrity now; the *code* rule (contracts only) preserves extractability. On split, FK → contract query + eventual consistency. |
| Activity timeline | **Unified table; system entries immutable, notes editable** | Separate immutable-audit + editable-notes tables | One timeline is the right UX; immutability flag preserves trust for system entries. Distinct from kernel `audit_log`. |
| Dedup | **Signal + service, no hard unique** | Hard unique on email | Hard unique rejects legitimately messy import data; per-tenant strict mode is opt-in later. |
| Partitioning | **Ready now, activate on signals** | Partition on day one | Premature partitioning before traffic data is the optimization the kernel forbids (Phase-5 precedent). |

---

## 12. Future Evolution

- **RFC-003 Lead Intelligence** writes Leads through `lead` contracts and reads CRM events; scoring populates `leads.score`; the consent flag governs any cross-tenant learning. No CRM rewrite.
- **Agent Runtime** — agents are `service_account` principals, authorized by the same PDP, reading/writing CRM via contracts; `ActivityLogged` feeds agent memory.
- **Communication / Outreach** consumes `LeadConverted`/`DealStageChanged` and writes `ActivityLogged` back (call logged, email sent) — the timeline becomes omnichannel without CRM changes.
- **Account Management / relationship health** derives entirely from the CRM event stream.
- **Analytics** builds pipeline/forecast/cohort read models from events; nothing heavy touches CRM OLTP.
- **Billing** consumes `DealWon` to originate an invoice — the §5 kernel note ("no `invoices` here") is honored; the seam is the event.
- **Microservice extraction:** `lead`/`deal`/`account` lift out independently; FKs → contract queries + eventual consistency; the outbox is already the boundary.
- **Custom objects** (beyond custom fields) is a later capability layered on the same definition pattern.

---

## 13. Build Plan — one phase at a time, stop at each gate

Mirror RFC-001 §6. Complete and pass the gate before the next phase.

- **Phase 0 — RFC + rules.** Land this RFC; add `.claude/rules/crm.md`; register the §8.1 permission catalog migration. **DoD:** permissions seeded; Nx tags for the five modules configured; CI green.
- **Phase 1 — Schema + RLS.** All 14 tables as forward-only migrations; RLS on every table (org **and** active-workspace); seed the default Pipeline + stages. **Gate:** a Testcontainers test proves Org A's context cannot read Org B's rows **and** Workspace A cannot read Workspace B's rows in the same org.
- **Phase 2 — Account + Contact.** Relationship core, `account_contacts`, soft delete with the open-Deal guard, erasure path. **Gate:** every write emits exactly one event atomically (rollback drops it); `ContactErased` purges PII and leaves a valid tombstone.
- **Phase 3 — Deal + Pipeline.** Stages, deals, **stage transitions as guarded domain ops**, `deal_stage_history` append-only, board counter. **Gate:** an illegal transition is rejected; a legal one appends history + emits `DealStageChanged`; optimistic-lock mismatch returns 409.
- **Phase 4 — Lead + Conversion + Import.** Lead lifecycle, dedup keys, merge, the `LeadConversionOrchestrator`, the idempotent `BulkImportOrchestrator`. **Gate:** conversion is atomic and one-shot (replay returns prior ids); re-POSTing an import with the same Idempotency-Key does not double-create.
- **Phase 5 — Authorization + parity.** Wire `lead.*`/`deal.*`/etc. through the PDP with ownership; verify service-account parity. **Gate:** default-deny verified on every CRM action; a Salesperson sees only owned/assigned rows; **a `service_account` principal is authorized to log an Activity on a Deal and is recorded as the actor.**
- **Phase 6 — API + edge.** Controllers, Zod→OpenAPI 3.1, Problem Details taxonomy, keyset pagination, idempotency, body-size limits, rate-limit wiring. **Gate:** OpenAPI regenerates clean; **all RFC-001 §7 kernel gates still pass** alongside the new CRM gates.

### CRM verification gates (must pass in CI)

1. **Tenant + workspace isolation** on every CRM table (RLS denies cross-org and cross-active-workspace reads).
2. **Default-deny** on every `resource.action`; ownership narrows further.
3. **Service-account parity** — an agent principal acts on CRM through the same PDP and is the recorded actor.
4. **Event atomicity** — rolled-back CRM transaction emits no event; committed emits exactly one.
5. **Conversion atomicity + one-shot** — Account/Contact/Deal/Lead-mark all-or-nothing; replay is idempotent.
6. **Import idempotency** — same file + Idempotency-Key never double-creates.
7. **Append-only integrity** — `deal_stage_history` and system `activities` reject update/delete at the grant level.
8. **PII erasure** — `contact.erase` purges PII, preserves referential validity, emits `ContactErased`.

---

## 14. How Claude Code must work here

- **Read this RFC and `CLAUDE.md` first; `CLAUDE.md` wins on any conflict.** This RFC adds **no** new isolation/auth/event mechanism — reuse the kernel's.
- **One phase at a time, stop at its gate** for human review. Write the gate tests (especially isolation, default-deny, conversion/import idempotency) **before or alongside** the code.
- **No dependency outside RFC-001 §2 without asking.** CSV parsing and similar small needs are proposed, not assumed.
- **Never weaken a §3 rule** to make a CRM task easier. If a request conflicts with the constitution, refuse and explain.
- Small, reviewable commits per module/slice. Domain layer stays free of framework/infrastructure imports. Integrate only via `contracts/`.
