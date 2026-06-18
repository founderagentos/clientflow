import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database, type Executor, type Tx } from '@agentos/persistence-kernel';
import { principals } from './principals.schema';

export interface PrincipalRow {
  id: string;
  type: string;
  status: string;
  tokenVersion: number;
}

@Injectable()
export class PrincipalsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Insert a human-principal supertype row with the caller-supplied id (shared-PK, §3.3). */
  async insertUserPrincipal(tx: Tx, id: string): Promise<void> {
    await tx.insert(principals).values({ id, type: 'user', status: 'active', tokenVersion: 0 });
  }

  async findById(id: string, executor: Executor = this.db): Promise<PrincipalRow | null> {
    const [row] = await executor
      .select({
        id: principals.id,
        type: principals.type,
        status: principals.status,
        tokenVersion: principals.tokenVersion,
      })
      .from(principals)
      .where(eq(principals.id, id))
      .limit(1);
    return row ?? null;
  }
}
