import { describe, it, expect, vi } from 'vitest';
import { withTenantTransaction, type TenantExecutor } from './rls';

class FakeTx implements TenantExecutor {
  readonly calls: unknown[] = [];
  execute = vi.fn(async (query: unknown): Promise<unknown> => {
    this.calls.push(query);
    return undefined;
  });
}

const fakeDb = (tx: FakeTx) => ({
  transaction: async <R>(work: (t: FakeTx) => Promise<R>): Promise<R> => work(tx),
});

describe('withTenantTransaction', () => {
  it('sets both tenant GUCs before running the work, then returns its result', async () => {
    const tx = new FakeTx();
    const order: string[] = [];
    tx.execute.mockImplementation(async () => {
      order.push('set_config');
    });

    const result = await withTenantTransaction(
      fakeDb(tx),
      { organizationId: 'org-1', workspaceId: 'ws-1' },
      async () => {
        order.push('work');
        return 42;
      },
    );

    expect(result).toBe(42);
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['set_config', 'set_config', 'work']);
  });

  it('tolerates an org-scoped unit of work (null workspace)', async () => {
    const tx = new FakeTx();
    await expect(
      withTenantTransaction(fakeDb(tx), { organizationId: 'org-1', workspaceId: null }, async () =>
        'ok',
      ),
    ).resolves.toBe('ok');
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });
});
