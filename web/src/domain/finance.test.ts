import { describe, expect, it } from 'vitest';
import {
  accountsWithBalances,
  forecast,
  moneyOverview,
  monthSummary,
  nearestPayment,
  purchaseAssessment,
  upcomingPayments,
} from '@/domain/finance.ts';
import type { FinanceSnapshot } from '@/domain/finance.ts';
import type {
  Account,
  AppSettings,
  Category,
  Debt,
  LedgerEntry,
  PlannedInflow,
  PlannedPayment,
  Transaction,
} from '@/domain/types.ts';
import { addDays, monthKey, todayKey } from '@/lib/dates.ts';

const NOW = new Date();
const MONTH = monthKey(NOW);
const TODAY_KEY = todayKey();
const TODAY = NOW.getDate();
// Every fixture transaction stays inside the current month and never in the future.
const atDay = (day: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), Math.max(1, Math.min(day, TODAY)), 12, 0, 0).toISOString();
const at = (day: number) => atDay(day);

const account = (
  id: string,
  name: string,
  type: Account['type'],
  opening: number,
  extra: Partial<Account> = {},
): Account => ({
  id,
  name,
  type,
  openingBalanceMinor: opening,
  openingBalanceAt: at(1),
  currency: 'RUB',
  sortOrder: 0,
  archived: false,
  createdAt: at(1),
  updatedAt: at(1),
  ...extra,
});

const settings: AppSettings = {
  id: 'app',
  onboardingComplete: true,
  currency: 'RUB',
  monthlyBudgetMinor: 200_000,
  theme: 'system',
  createdAt: at(1),
  updatedAt: at(1),
};

const category = (id: string, name: string, kind: Category['kind']): Category => ({
  id,
  name,
  kind,
  icon: 'wallet',
  sortOrder: 0,
  isSystem: true,
  createdAt: at(1),
  updatedAt: at(1),
});

const tx = (
  id: string,
  kind: Transaction['kind'],
  amountMinor: number,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  kind,
  amountMinor,
  occurredAt: at(10),
  description: kind,
  clientRequestId: `req-${id}`,
  source: 'manual',
  createdAt: at(10),
  updatedAt: at(10),
  deletedAt: null,
  rev: 1,
  ...extra,
});

const entry = (
  transactionId: string,
  accountId: string | null,
  categoryId: string | null,
  amountMinor: number,
): LedgerEntry => ({
  id: `e-${transactionId}-${accountId ?? categoryId}-${amountMinor}`,
  transactionId,
  accountId,
  categoryId,
  amountMinor,
});

const debt: Debt = {
  id: 'debt-1',
  direction: 'owed_to_me',
  counterparty: 'Друг',
  amountMinor: 100_000,
  paidMinor: 50_000,
  status: 'open',
  createdAt: at(1),
  updatedAt: at(1),
};

const inflow: PlannedInflow = {
  id: 'inflow-1',
  name: 'Зарплата',
  amountMinor: 300_000,
  expectedDate: addDays(TODAY_KEY, 5),
  confidence: 'confirmed',
  createdAt: at(1),
  updatedAt: at(1),
};

const plannedPayment: PlannedPayment = {
  id: 'payment-1',
  name: 'Аренда',
  amountMinor: 50_000,
  dayOfMonth: Number(addDays(TODAY_KEY, 2).slice(8, 10)),
  active: true,
  createdAt: at(1),
  updatedAt: at(1),
};

const accounts = [
  account('cash', 'Наличные', 'cash', 10_000),
  account('debit', 'Дебетовая карта', 'debit', 500_000),
  account('savings', 'Накопительный', 'savings', 0),
  account('credit', 'Кредитка', 'credit', -200_000, {
    creditLimitMinor: 1_000_000,
  }),
];

const transactions = [
  tx('expense-1', 'expense', 100_000, {
    accountId: 'debit',
    categoryId: 'groceries',
    occurredAt: at(10),
  }),
  tx('income-1', 'income', 200_000, {
    accountId: 'debit',
    categoryId: 'salary',
    occurredAt: at(5),
  }),
  tx('transfer-1', 'transfer', 50_000, {
    fromAccountId: 'debit',
    toAccountId: 'savings',
    occurredAt: at(7),
  }),
  tx('credit-payment-1', 'credit_payment', 30_000, {
    fromAccountId: 'debit',
    toAccountId: 'credit',
    occurredAt: at(8),
  }),
  tx('deleted-1', 'expense', 70_000, {
    accountId: 'debit',
    categoryId: 'groceries',
    occurredAt: at(9),
    deletedAt: at(11),
  }),
];

const entries = [
  entry('expense-1', 'debit', null, -100_000),
  entry('expense-1', null, 'groceries', 100_000),
  entry('income-1', 'debit', null, 200_000),
  entry('income-1', null, 'salary', -200_000),
  entry('transfer-1', 'debit', null, -50_000),
  entry('transfer-1', 'savings', null, 50_000),
  entry('credit-payment-1', 'debit', null, -30_000),
  entry('credit-payment-1', 'credit', null, 30_000),
  entry('deleted-1', 'debit', null, -70_000),
  entry('deleted-1', null, 'groceries', 70_000),
];

function snapshot(overrides: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  return {
    accounts,
    categories: [category('groceries', 'Продукты', 'expense'), category('salary', 'Зарплата', 'income')],
    transactions,
    entries,
    debts: [debt],
    goals: [],
    plannedPayments: [plannedPayment],
    plannedInflows: [inflow],
    budgets: [],
    settings,
    ...overrides,
  };
}

describe('balances', () => {
  it('derives balances from opening balances and ignores deleted transactions', () => {
    const balances = new Map(accountsWithBalances(snapshot()).map((item) => [item.id, item.balanceMinor]));
    expect(balances.get('cash')).toBe(10_000);
    expect(balances.get('debit')).toBe(520_000);
    expect(balances.get('savings')).toBe(50_000);
    expect(balances.get('credit')).toBe(-170_000);
  });

  it('does not count credit limit, receivables or expected income as own money', () => {
    const overview = moneyOverview(snapshot());
    expect(overview.ownFundsMinor).toBe(410_000);
    expect(overview.liquidMinor).toBe(580_000);
    expect(overview.creditDebtMinor).toBe(170_000);
    expect(overview.creditLimitMinor).toBe(1_000_000);
    expect(overview.creditAvailableMinor).toBe(830_000);
    expect(overview.receivablesMinor).toBe(50_000);
    expect(overview.netWorthMinor).toBe(460_000);

    const withoutInflow = moneyOverview(snapshot({ plannedInflows: [] }));
    expect(withoutInflow.ownFundsMinor).toBe(overview.ownFundsMinor);
  });
});

describe('month summary', () => {
  it('counts only real income and expenses, not transfers or credit repayment', () => {
    const summary = monthSummary(snapshot(), MONTH, NOW);
    expect(summary.incomeMinor).toBe(200_000);
    expect(summary.expenseMinor).toBe(100_000);
    expect(summary.refundMinor).toBe(0);
    expect(summary.netMinor).toBe(100_000);
    expect(summary.transactionCount).toBe(4);
    expect(summary.budgetMinor).toBe(200_000);
    expect(summary.availableBudgetMinor).toBe(100_000);
    expect(summary.budgetUsedPercent).toBe(50);
    expect(summary.expenseByCategory).toHaveLength(1);
    expect(summary.expenseByCategory[0]?.categoryId).toBe('groceries');
  });

  it('subtracts refunds from category spending without treating them as income', () => {
    const refund = tx('refund-1', 'refund', 25_000, {
      accountId: 'debit',
      categoryId: 'groceries',
      occurredAt: at(12),
    });
    const refundEntries = [
      entry('refund-1', 'debit', null, 25_000),
      entry('refund-1', null, 'groceries', -25_000),
    ];
    const summary = monthSummary(
      snapshot({
        transactions: [...transactions, refund],
        entries: [...entries, ...refundEntries],
      }),
      MONTH,
      NOW,
    );
    expect(summary.incomeMinor).toBe(200_000);
    expect(summary.expenseMinor).toBe(100_000);
    expect(summary.refundMinor).toBe(25_000);
    expect(summary.expenseByCategory[0]?.amountMinor).toBe(75_000);
    // Net spending is 75 000, so more of the 200 000 budget is still available.
    expect(summary.availableBudgetMinor).toBe(125_000);
    expect(summary.budgetUsedPercent).toBe(37.5);
    expect(summary.averageDailyExpenseMinor).toBe(
      Math.round(75_000 / summary.daysElapsed),
    );
  });

  it('uses the month-specific budget when present', () => {
    const summary = monthSummary(
      snapshot({ budgets: [{ month: MONTH, amountMinor: 150_000, updatedAt: at(1) }] }),
      MONTH,
      NOW,
    );
    expect(summary.budgetMinor).toBe(150_000);
    expect(summary.availableBudgetMinor).toBe(50_000);
  });
});

describe('planning and forecast', () => {
  it('finds the nearest payment and expected inflow without adding it to balances', () => {
    const upcoming = upcomingPayments(snapshot(), TODAY_KEY);
    expect(upcoming[0]?.name).toBe('Аренда');
    expect(upcoming[0]?.daysUntil).toBe(2);
    expect(nearestPayment(snapshot(), TODAY_KEY)?.dueDate).toBe(addDays(TODAY_KEY, 2));
  });

  it('projects a shortfall when spending outruns money before payday', () => {
    const result = forecast(snapshot(), MONTH, NOW);
    expect(result.nextInflow?.inflow.name).toBe('Зарплата');
    expect(result.daysUntilNextInflow).toBe(5);
    expect(result.upcomingObligationsMinor).toBe(50_000);
    expect(result.projectedBalanceUntilInflowMinor).toBeGreaterThan(0);
    expect(result.runwayDays).not.toBeNull();
  });

  it('assesses a purchase against own money and obligations', () => {
    const good = purchaseAssessment(200_000, snapshot(), NOW);
    expect(good.level).toBe('good');
    expect(good.affordable).toBe(true);
    expect(good.afterPurchaseMinor).toBe(210_000);
    expect(good.afterObligationsMinor).toBe(160_000);

    const dangerous = purchaseAssessment(400_000, snapshot(), NOW);
    expect(dangerous.level).toBe('danger');
    expect(dangerous.affordable).toBe(false);
    expect(dangerous.afterObligationsMinor).toBe(-40_000);

    const impossible = purchaseAssessment(500_000, snapshot(), NOW);
    expect(impossible.level).toBe('danger');
    expect(impossible.reason).toContain('Кредитный лимит');
  });
});
