import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinanceDB } from '@/db/db.ts';
import { createFinanceDb } from '@/db/db.ts';
import { createAccount } from '@/db/accounts.ts';
import { ensureBaseData, DEFAULT_CATEGORY_IDS } from '@/db/defaults.ts';
import { createDebt } from '@/db/planning.ts';
import {
  createTransaction,
  deleteTransaction,
  restoreTransaction,
  updateTransaction,
} from '@/db/transactions.ts';
import { accountsWithBalances, moneyOverview, monthSummary } from '@/domain/finance.ts';
import { monthKey } from '@/lib/dates.ts';
import type { Transaction } from '@/domain/types.ts';
import { openTestDb, readSnapshot } from '@/test/helpers.ts';

function draftFrom(transaction: Transaction) {
  return {
    kind: transaction.kind,
    amountMinor: transaction.amountMinor,
    occurredAt: transaction.occurredAt,
    description: transaction.description,
    accountId: transaction.accountId,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    categoryId: transaction.categoryId,
    debtId: transaction.debtId,
    clientRequestId: transaction.clientRequestId,
    source: transaction.source,
  };
}

async function balanceOf(database: FinanceDB, accountId: string): Promise<number> {
  const snapshot = await readSnapshot(database);
  return accountsWithBalances(snapshot).find((item) => item.id === accountId)!.balanceMinor;
}

describe('transaction storage', () => {
  let database: FinanceDB;

  beforeEach(async () => {
    database = await openTestDb();
  });

  afterEach(async () => {
    await database.delete();
  });

  it('keeps balances, transfers, credit payments and statistics consistent', async () => {
    const cash = await createAccount(database, {
      name: 'Наличные',
      type: 'cash',
      openingBalanceMinor: 10_000_00,
    });
    const debit = await createAccount(database, {
      name: 'Дебетовая карта',
      type: 'debit',
      openingBalanceMinor: 50_000_00,
    });
    const savings = await createAccount(database, {
      name: 'Накопительный',
      type: 'savings',
      openingBalanceMinor: 0,
    });
    const credit = await createAccount(database, {
      name: 'Кредитка',
      type: 'credit',
      openingBalanceMinor: -20_000_00,
      creditLimitMinor: 100_000_00,
    });

    await createTransaction(database, {
      kind: 'income',
      amountMinor: 20_000_00,
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.salary,
      description: 'Зарплата',
      clientRequestId: 'income-1',
    });
    await createTransaction(database, {
      kind: 'expense',
      amountMinor: 3_000_00,
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      description: 'Продукты',
      clientRequestId: 'expense-1',
    });
    await createTransaction(database, {
      kind: 'transfer',
      amountMinor: 5_000_00,
      fromAccountId: debit.id,
      toAccountId: savings.id,
      clientRequestId: 'transfer-1',
    });
    await createTransaction(database, {
      kind: 'credit_payment',
      amountMinor: 4_000_00,
      fromAccountId: debit.id,
      toAccountId: credit.id,
      clientRequestId: 'credit-payment-1',
    });
    await createTransaction(database, {
      kind: 'expense',
      amountMinor: 2_000_00,
      accountId: credit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      description: 'Продукты с кредитки',
      clientRequestId: 'credit-expense-1',
    });

    const snapshot = await readSnapshot(database);
    const balances = new Map(
      accountsWithBalances(snapshot).map((item) => [item.id, item.balanceMinor]),
    );
    expect(balances.get(cash.id)).toBe(10_000_00);
    expect(balances.get(debit.id)).toBe(58_000_00);
    expect(balances.get(savings.id)).toBe(5_000_00);
    expect(balances.get(credit.id)).toBe(-18_000_00);

    const overview = moneyOverview(snapshot);
    expect(overview.ownFundsMinor).toBe(55_000_00);
    expect(overview.creditDebtMinor).toBe(18_000_00);
    expect(overview.creditAvailableMinor).toBe(82_000_00);
    expect(overview.creditLimitMinor).toBe(100_000_00);

    const summary = monthSummary(snapshot, monthKey());
    expect(summary.incomeMinor).toBe(20_000_00);
    expect(summary.expenseMinor).toBe(5_000_00);
    expect(summary.transactionCount).toBe(5);
  });

  it('is idempotent for a repeated clientRequestId', async () => {
    const debit = await createAccount(database, {
      name: 'Карта',
      type: 'debit',
      openingBalanceMinor: 10_000_00,
    });
    const draft = {
      kind: 'expense' as const,
      amountMinor: 1_000_00,
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      clientRequestId: 'same-request',
    };
    const first = await createTransaction(database, draft);
    const second = await createTransaction(database, draft);
    expect(second.id).toBe(first.id);
    expect(await database.transactions.count()).toBe(1);
    expect(await database.entries.count()).toBe(2);
    expect(await balanceOf(database, debit.id)).toBe(9_000_00);
  });

  it('rolls back completely when validation fails', async () => {
    const debit = await createAccount(database, {
      name: 'Карта',
      type: 'debit',
      openingBalanceMinor: 10_000_00,
    });
    await expect(
      createTransaction(database, {
        kind: 'expense',
        amountMinor: 1_000_00,
        accountId: debit.id,
        categoryId: DEFAULT_CATEGORY_IDS.salary,
        clientRequestId: 'invalid-request',
      }),
    ).rejects.toThrow('не подходит');

    expect(await database.transactions.count()).toBe(0);
    expect(await database.entries.count()).toBe(0);
    expect(await balanceOf(database, debit.id)).toBe(10_000_00);
  });

  it('edits, soft-deletes and restores without leaving drift', async () => {
    const debit = await createAccount(database, {
      name: 'Карта',
      type: 'debit',
      openingBalanceMinor: 50_000_00,
    });
    const created = await createTransaction(database, {
      kind: 'expense',
      amountMinor: 3_000_00,
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      clientRequestId: 'edit-request',
    });
    expect(await balanceOf(database, debit.id)).toBe(47_000_00);

    const edited = await updateTransaction(database, created.id, {
      ...draftFrom(created),
      amountMinor: 4_000_00,
    });
    expect(edited.rev).toBe(2);
    expect(await balanceOf(database, debit.id)).toBe(46_000_00);
    const entries = await database.entries.where('transactionId').equals(created.id).toArray();
    expect(entries).toHaveLength(2);
    expect(entries.reduce((total, item) => total + item.amountMinor, 0)).toBe(0);

    await deleteTransaction(database, created.id);
    expect(await balanceOf(database, debit.id)).toBe(50_000_00);

    await restoreTransaction(database, created.id);
    expect(await balanceOf(database, debit.id)).toBe(46_000_00);
  });

  it('applies debt payments to the debt without adding income or expense', async () => {
    const debit = await createAccount(database, {
      name: 'Карта',
      type: 'debit',
      openingBalanceMinor: 50_000_00,
    });
    const debt = await createDebt(database, {
      direction: 'owed_to_me',
      counterparty: 'Друг',
      amountMinor: 10_000_00,
    });

    const payment = await createTransaction(database, {
      kind: 'debt_payment',
      amountMinor: 4_000_00,
      accountId: debit.id,
      debtId: debt.id,
      clientRequestId: 'debt-payment-1',
    });
    expect(await balanceOf(database, debit.id)).toBe(54_000_00);
    expect((await database.debts.get(debt.id))?.paidMinor).toBe(4_000_00);

    const summary = monthSummary(await readSnapshot(database), monthKey());
    expect(summary.incomeMinor).toBe(0);
    expect(summary.expenseMinor).toBe(0);
    expect(summary.transactionCount).toBe(1);

    await deleteTransaction(database, payment.id);
    expect(await balanceOf(database, debit.id)).toBe(50_000_00);
    expect((await database.debts.get(debt.id))?.paidMinor).toBe(0);

    await restoreTransaction(database, payment.id);
    expect(await balanceOf(database, debit.id)).toBe(54_000_00);
    expect((await database.debts.get(debt.id))?.paidMinor).toBe(4_000_00);
  });

  it('persists records across close and reopen', async () => {
    const name = `pf-persist-${crypto.randomUUID()}`;
    const first = createFinanceDb(name);
    await first.open();
    await ensureBaseData(first);
    const debit = await createAccount(first, {
      name: 'Карта',
      type: 'debit',
      openingBalanceMinor: 10_000_00,
    });
    await createTransaction(first, {
      kind: 'expense',
      amountMinor: 1_500_00,
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      clientRequestId: 'persist-1',
    });
    first.close();

    const reopened = createFinanceDb(name);
    await reopened.open();
    try {
      expect(await reopened.transactions.count()).toBe(1);
      expect(await balanceOf(reopened, debit.id)).toBe(8_500_00);
    } finally {
      await reopened.delete();
    }
  });
});
