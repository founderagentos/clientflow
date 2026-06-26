-- CRM Core grants (RFC-002 §6). RLS policies (050) decide *which rows*; these GRANTs decide whether
-- app_user can touch the table at all. No DELETE anywhere — every CRM table uses the soft-delete
-- column contract (§3.4), so app code never issues a real DELETE (untagging / unlinking is an
-- UPDATE of deleted_at). deal_stage_history is the one append-only table: SELECT + INSERT only,
-- never UPDATE — that grant is what makes velocity/forecast history trustworthy (gate 7).

GRANT SELECT, INSERT, UPDATE ON
  leads,
  import_jobs,
  accounts,
  contacts,
  account_contacts,
  pipelines,
  pipeline_stages,
  deals,
  activities,
  tasks,
  tags,
  taggables,
  custom_field_definitions
TO app_user;

-- deal_stage_history is append-only (CLAUDE.md §5): SELECT, INSERT only, never UPDATE/DELETE.
GRANT SELECT, INSERT ON deal_stage_history TO app_user;

-- platform_operator: read-only across every CRM table (support tooling, audited at the app layer).
GRANT SELECT ON
  leads,
  import_jobs,
  accounts,
  contacts,
  account_contacts,
  pipelines,
  pipeline_stages,
  deals,
  deal_stage_history,
  activities,
  tasks,
  tags,
  taggables,
  custom_field_definitions
TO platform_operator;
