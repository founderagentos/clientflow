import { sql, type SQL } from 'drizzle-orm';

export interface TenantTxScope {
  organizationId: string;
  /** null/undefined = org-scoped unit of work. */
  workspaceId?: string | null;
}

/** Minimal structural type of a transaction handle that can execute SQL. */
export interface TenantExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Minimal structural type of a DB handle that can open a transaction. */
export interface TenantTransactor<TTx extends TenantExecutor> {
  transaction<R>(work: (tx: TTx) => Promise<R>): Promise<R>;
}

/**
 * Run `work` inside a single DB transaction with the tenant GUCs set
 * **transaction-locally** (the `true` = is_local arg), so every statement is subject to
 * the RLS policies keyed on `app.current_organization_id` (CLAUDE.md §3.6/§3.7).
 *
 * Values are bound parameters via `set_config(...)` — the parameterized, transaction-scoped
 * equivalent of `SET LOCAL` (which cannot take bind parameters directly).
 */
export async function withTenantTransaction<TTx extends TenantExecutor, R>(
  db: TenantTransactor<TTx>,
  scope: TenantTxScope,
  work: (tx: TTx) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_organization_id', ${scope.organizationId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.current_workspace_id', ${scope.workspaceId ?? ''}, true)`,
    );
    return work(tx);
  });
}
