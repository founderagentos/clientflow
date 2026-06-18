import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text column backed by Postgres's `citext` extension — used for columns
 * compared case-insensitively (emails, slugs). Requires `CREATE EXTENSION IF NOT EXISTS citext;`
 * (applied in db/policies/000-roles.sql, ahead of any migration that creates a citext column).
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
