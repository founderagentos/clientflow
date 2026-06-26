import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { newId } from '@agentos/identifier';
import type { Tx } from '@agentos/persistence-kernel';
import { dealStageHistory } from './deal-stage-history.schema';

/**
 * Append-only access to `deal_stage_history` (RFC-002 §6.1 / gate 7) — INSERT + SELECT only; the
 * grant (051-crm-grants.sql) forbids UPDATE/DELETE, which is what makes velocity/forecast trustworthy.
 */
@Injectable()
export class DealStageHistoryRepository {
  async append(
    tx: Tx,
    input: {
      organizationId: string;
      workspaceId: string;
      dealId: string;
      fromStageId: string | null;
      toStageId: string;
      durationInPreviousSeconds: number | null;
      actorPrincipalId: string;
    },
  ): Promise<void> {
    await tx.insert(dealStageHistory).values({
      id: newId(),
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      dealId: input.dealId,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
      durationInPreviousSeconds: input.durationInPreviousSeconds,
      actorPrincipalId: input.actorPrincipalId,
    });
  }

  /** The most recent entry for a deal — its `entered_at` is when the deal entered its current stage. */
  async findLatestForDeal(tx: Tx, dealId: string): Promise<{ enteredAt: Date } | null> {
    const [row] = await tx
      .select({ enteredAt: dealStageHistory.enteredAt })
      .from(dealStageHistory)
      .where(eq(dealStageHistory.dealId, dealId))
      .orderBy(desc(dealStageHistory.enteredAt))
      .limit(1);
    return row ?? null;
  }
}
