import type { Account, Debt, Goal, PlannedPayment } from '../domain/types.ts';
import { monthKey, nowIso } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import type { FinanceDB } from './db.ts';
import { clearFinancialData } from './db.ts';
import { ensureBaseData, DEFAULT_CATEGORY_IDS } from './defaults.ts';
import { createTransaction } from './transactions.ts';
import { auditRecord } from './audit.ts';

function dayThisMonth(day: number): string {
  const now = new Date();
  const maxDay = now.getDate();
  const safeDay = Math.max(1, Math.min(day, maxDay));
  return new Date(now.getFullYear(), now.getMonth(), safeDay, 12, 0, 0, 0).toISOString();
}

function futureDate(day: number): string {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), day, 12);
  if (candidate.getDate() < now.getDate()) candidate.setMonth(candidate.getMonth() + 1);
  return candidate.toISOString().slice(0, 10);
}

/**
 * Fictional data for trying the interface. Never loaded automatically.
 * All values are invented and contain no personal information.
 */
export async function loadDemoData(database: FinanceDB): Promise<void> {
  await clearFinancialData(database);
  await ensureBaseData(database);
  const now = nowIso();
  const month = monthKey();

  const cash: Account = {
    id: newId(),
    name: 'Наличные',
    type: 'cash',
    openingBalanceMinor: 8_000_00,
    openingBalanceAt: now,
    currency: 'RUB',
    sortOrder: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const debit: Account = {
    id: newId(),
    name: 'Дебетовая карта',
    type: 'debit',
    openingBalanceMinor: 94_500_00,
    openingBalanceAt: now,
    currency: 'RUB',
    sortOrder: 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const savings: Account = {
    id: newId(),
    name: 'Накопительный счёт',
    type: 'savings',
    openingBalanceMinor: 30_000_00,
    openingBalanceAt: now,
    currency: 'RUB',
    sortOrder: 2,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const credit: Account = {
    id: newId(),
    name: 'Кредитная карта',
    type: 'credit',
    openingBalanceMinor: -23_400_00,
    openingBalanceAt: now,
    currency: 'RUB',
    creditLimitMinor: 150_000_00,
    paymentDueDay: 20,
    statementDay: 1,
    sortOrder: 3,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const debt: Debt = {
    id: newId(),
    direction: 'owed_to_me',
    counterparty: 'Демо-должник',
    amountMinor: 15_000_00,
    paidMinor: 5_000_00,
    dueDate: null,
    note: 'Вымышленный долг для демонстрации',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const goal: Goal = {
    id: newId(),
    name: 'Отпуск',
    targetMinor: 120_000_00,
    savedMinor: 30_000_00,
    deadline: `${month}-28`,
    note: 'Демонстрационная цель',
    color: '#10b981',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const payments: PlannedPayment[] = [
    {
      id: newId(),
      name: 'Аренда',
      amountMinor: 35_000_00,
      dayOfMonth: 5,
      accountId: debit.id,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: newId(),
      name: 'Интернет',
      amountMinor: 900_00,
      dayOfMonth: 12,
      accountId: debit.id,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: newId(),
      name: 'Платёж по кредитке',
      amountMinor: 8_000_00,
      dayOfMonth: 20,
      accountId: debit.id,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];

  await database.transaction(
    'rw',
    [
      database.accounts,
      database.debts,
      database.goals,
      database.plannedPayments,
      database.plannedInflows,
      database.settings,
      database.budgets,
      database.audit,
    ],
    async () => {
      await database.accounts.bulkAdd([cash, debit, savings, credit]);
      await database.debts.add(debt);
      await database.goals.add(goal);
      await database.plannedPayments.bulkAdd(payments);
      await database.plannedInflows.add({
        id: newId(),
        name: 'Зарплата',
        amountMinor: 120_000_00,
        expectedDate: futureDate(5),
        confidence: 'confirmed',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await database.settings.put({
        id: 'app',
        onboardingComplete: true,
        currency: 'RUB',
        monthlyBudgetMinor: 70_000_00,
        defaultAccountId: debit.id,
        theme: 'system',
        createdAt: now,
        updatedAt: now,
      });
      await database.budgets.put({ month, amountMinor: 70_000_00, updatedAt: now });
      await database.audit.add(
        auditRecord('demo.load', 'settings', 'app', undefined, { note: 'fictional demo data' }),
      );
    },
  );

  const transactions = [
    {
      kind: 'income' as const,
      amountMinor: 120_000_00,
      occurredAt: dayThisMonth(5),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.salary,
      description: 'Зарплата (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 35_000_00,
      occurredAt: dayThisMonth(5),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.housing,
      description: 'Аренда (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 4_280_00,
      occurredAt: dayThisMonth(3),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      description: 'Продукты (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 1_350_00,
      occurredAt: dayThisMonth(4),
      accountId: cash.id,
      categoryId: DEFAULT_CATEGORY_IDS.cafe,
      description: 'Кофе и обед (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 640_00,
      occurredAt: dayThisMonth(6),
      accountId: cash.id,
      categoryId: DEFAULT_CATEGORY_IDS.transport,
      description: 'Транспорт (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 5_200_00,
      occurredAt: dayThisMonth(10),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.housing,
      description: 'Коммунальные услуги (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 900_00,
      occurredAt: dayThisMonth(12),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.communication,
      description: 'Интернет (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 2_400_00,
      occurredAt: dayThisMonth(14),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.health,
      description: 'Аптека (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 1_800_00,
      occurredAt: dayThisMonth(16),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.entertainment,
      description: 'Кино (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 799_00,
      occurredAt: dayThisMonth(17),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      description: 'Подписка (демо)',
    },
    {
      kind: 'expense' as const,
      amountMinor: 5_120_00,
      occurredAt: dayThisMonth(19),
      accountId: debit.id,
      categoryId: DEFAULT_CATEGORY_IDS.groceries,
      description: 'Продукты (демо)',
    },
    {
      kind: 'transfer' as const,
      amountMinor: 10_000_00,
      occurredAt: dayThisMonth(7),
      fromAccountId: debit.id,
      toAccountId: savings.id,
      description: 'В накопительный счёт (демо)',
    },
    {
      kind: 'credit_payment' as const,
      amountMinor: 8_000_00,
      occurredAt: dayThisMonth(20),
      fromAccountId: debit.id,
      toAccountId: credit.id,
      description: 'Погашение кредитки (демо)',
    },
    {
      kind: 'refund' as const,
      amountMinor: 350_00,
      occurredAt: dayThisMonth(21),
      accountId: cash.id,
      categoryId: DEFAULT_CATEGORY_IDS.cafe,
      description: 'Возврат за заказ (демо)',
    },
    {
      kind: 'debt_payment' as const,
      amountMinor: 5_000_00,
      occurredAt: dayThisMonth(22),
      accountId: debit.id,
      debtId: debt.id,
      description: 'Возврат долга (демо)',
    },
  ];

  for (const [index, transaction] of transactions.entries()) {
    await createTransaction(database, {
      ...transaction,
      source: 'demo',
      clientRequestId: `demo-${index}-${month}`,
    });
  }
}
