import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE, type Database, type Executor, type Tx } from '@agentos/persistence-kernel';
import { users } from './users.schema';

export interface UserRow {
  id: string;
  primaryEmail: string;
  displayName: string;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Shared-PK specialization of principals: `id` equals the principal id (§3.3). */
  async insert(
    tx: Tx,
    input: { id: string; primaryEmail: string; displayName: string },
  ): Promise<void> {
    await tx.insert(users).values({
      id: input.id,
      primaryEmail: input.primaryEmail,
      displayName: input.displayName,
    });
  }

  async existsByEmail(email: string, executor: Executor = this.db): Promise<boolean> {
    const [row] = await executor
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryEmail, email), isNull(users.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async findById(id: string, executor: Executor = this.db): Promise<UserRow | null> {
    const [row] = await executor
      .select({ id: users.id, primaryEmail: users.primaryEmail, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }
}
