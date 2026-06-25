---
scope: scope:crm
budget: 100
last-reviewed: Phase 0
---

# CRM Core rules

The first product bounded context (RFC-002), a pure tenant of the kernel — five modules under
`modules/crm/` (`lead`, `account`, `deal`, `activity`, `customization`). Design of record:
[docs/rfc-002-crm-core.md](../../docs/rfc-002-crm-core.md). It adds **no** new isolation/auth/event
mechanism — reuse the kernel's. `CLAUDE.md` wins on any conflict.

## Gotchas
- **Account ≠ Organization** — the single most dangerous naming trap (RFC §2.1). An `Account` is a
  business the tenant sells to, living *inside* a tenant; the kernel `Organization` *is* the tenant.
  Likewise `Contact` ≠ kernel `User`/`Principal` (a Contact never authenticates).
- **CRM RLS is org AND active-workspace** (RFC §6) — unlike kernel tables, which are org-only. Policy
  is `organization_id = …current_organization_id AND (workspace_id IS NULL OR workspace_id =
  …current_workspace_id)`. The workspace GUC is already set by `withTenantTransaction`.
- **No hard unique on contact/lead email** (RFC §6.2) — real import data is legitimately duplicated.
  Dedup is a *signal* (`email_normalized`, `phone_e164`, `domain` + a matching service), never a DB
  constraint. A hard unique would reject good imports.
- **`deal_stage_history` and `is_system=true` activities are append-only** — INSERT-only grant, no
  UPDATE/DELETE. This is what makes velocity/forecast and the human timeline trustworthy.
- **Lead conversion pointers are write-once** (RFC §6.2) — `converted_at` + produced
  account/contact/deal ids set once; re-conversion returns the existing ids (one-shot, idempotent).
- **Custom fields are inline validated `jsonb` governed by `custom_field_definitions`, NOT EAV**
  (RFC §11). GIN-index each entity's `custom_fields`. Distinct from the kernel `metadata` jsonb.
- **Forbidden synonyms** (RFC §2.1): company/client/customer/firm → **Account**; person/user →
  **Contact**; opportunity/job → **Deal**. One concept, one word, everywhere.

## Cross-module contracts
- Modules reference each other **by UUIDv7 id only**, via published `contracts/` queries — never by
  importing another module's domain/infrastructure (Nx `type:module` boundary fails CI otherwise).
  Cross-CRM atomic operations (e.g. lead conversion, bulk import) live in `apps/api/src/crm/` host
  orchestrators, mirroring the kernel's `RegistrationOrchestrator`.
- `*.export` and `contact.erase` are **sensitive** permissions (RFC §8.1) — always audited, gated to
  elevated roles (Owner; not Member) by default.
