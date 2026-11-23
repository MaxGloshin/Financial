import {
  daysElapsedInMonth,
  daysInMonth,
  daysRemainingInMonth,
  monthKey,
  monthRange,
  nextOccurrenceOfDay,
  todayKey,
  daysUntil,
} from '../lib/dates.ts';
import { formatMoney } from '../lib/money.ts';
import type {
  Account,
  AccountWithBalance,
  AppSettings,
  Budget,
  Category,
  Debt,
  Goal,
  LedgerEntry,
  PlannedInflow,
  PlannedPayment,
  Transaction,
} from './types.ts';

export type FinanceSnapshot = {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  entries: LedgerEntry[];
  debts: Debt[];
  goals: Goal[];
  plannedPayments: PlannedPayment[];
  plannedInflows: PlannedInflow[];
  budgets: Budget[];
  settings: AppSettings;
};

export type CategoryAmount = {
  categoryId: string;
  name: string;
  kind: Category['kind'];
  amountMinor: number;
  share: number;
};

export type MonthSummary = {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  refundMinor: number;
  netMinor: number;
  expenseByCategory: CategoryAmount[];
  incomeByCategory: CategoryAmount[];
  transactionCount: number;
  budgetMinor: number;
  availableBudgetMinor: number;
  budgetUsedPercent: number;
  averageDailyExpenseMinor: number;
  forecastMonthEndExpenseMinor: number;
  daysElapsed: number;
  daysRemaining: number;
};

export type UpcomingPayment = {
  id: string;
  name: string;
  amountMinor: number | null;
  dueDate: string;
  daysUntil: number;
  source: 'planned' | 'credit';
};

export type NextInflow = {
  inflow: PlannedInflow;
  daysUntil: number;
};

export type MoneyOverview = {
  balances: AccountWithBalance[];
  ownFundsMinor: number;
  liquidMinor: number;
  cashMinor: number;
  debitMinor: number;
  savingsMinor: number;
  creditDebtMinor: number;
  creditLimitMinor: number;
  creditAvailableMinor: number;
  receivablesMinor: number;
  payablesMinor: number;
  netWorthMinor: number;
};

export type PurchaseAssessment = {
  affordable: boolean;
  amountMinor: number;
  afterPurchaseMinor: number;
  afterObligationsMinor: number;
  upcomingObligationsMinor: number;
  reason: string;
  level: 'good' | 'warning' | 'danger';
};

export function isActive(tx: Transaction): boolean {
  return !tx.deletedAt;
}

export function activeTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(isActive);
}

/**
 * Account balance = signed opening balance + all postings of non-deleted
 * transactions. Balances are derived, never stored, so they cannot drift.
 */
export function computeBalances(
  accounts: Account[],
  entries: LedgerEntry[],
  transactions: Transaction[],
): Map<string, number> {
  const active = new Set(activeTransactions(transactions).map((tx) => tx.id));
  const balances = new Map<string, number>();
  for (const account of accounts) balances.set(account.id, account.openingBalanceMinor);
  for (const entry of entries) {
    if (!entry.accountId || !active.has(entry.transactionId)) continue;
    balances.set(entry.accountId, (balances.get(entry.accountId) ?? 0) + entry.amountMinor);
  }
  return balances;
}

export function accountsWithBalances(snapshot: FinanceSnapshot): AccountWithBalance[] {
  const balances = computeBalances(snapshot.accounts, snapshot.entries, snapshot.transactions);
  return snapshot.accounts
    .map((account) => ({ ...account, balanceMinor: balances.get(account.id) ?? 0 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
}

export function moneyOverview(snapshot: FinanceSnapshot): MoneyOverview {
  const balances = accountsWithBalances(snapshot);
  const activeBalances = balances.filter((account) => !account.archived);

  const sum = (types: Account['type'][]) =>
    activeBalances
      .filter((account) => types.includes(account.type))
      .reduce((total, account) => total + account.balanceMinor, 0);

  const cashMinor = sum(['cash']);
  const debitMinor = sum(['debit']);
  const savingsMinor = sum(['savings']);
  const creditBalance = sum(['credit']);
  const creditDebtMinor = Math.max(0, -creditBalance);
  const creditLimitMinor = activeBalances
    .filter((account) => account.type === 'credit')
    .reduce((total, account) => total + (account.creditLimitMinor ?? 0), 0);

  const liquidMinor = cashMinor + debitMinor + savingsMinor;
  const ownFundsMinor = liquidMinor + creditBalance;
  const receivablesMinor = snapshot.debts
    .filter((debt) => debt.direction === 'owed_to_me' && !debt.deletedAt && debt.status !== 'paid')
    .reduce((total, debt) => total + Math.max(0, debt.amountMinor - debt.paidMinor), 0);
  const payablesMinor = snapshot.debts
    .filter((debt) => debt.direction === 'i_owe' && !debt.deletedAt && debt.status !== 'paid')
    .reduce((total, debt) => total + Math.max(0, debt.amountMinor - debt.paidMinor), 0);

  return {
    balances,
    ownFundsMinor,
    liquidMinor,
    cashMinor,
    debitMinor,
    savingsMinor,
    creditDebtMinor,
    creditLimitMinor,
    creditAvailableMinor:
      creditLimitMinor > 0 ? Math.max(0, creditLimitMinor - creditDebtMinor) : 0,
    receivablesMinor,
    payablesMinor,
    netWorthMinor: ownFundsMinor + receivablesMinor - payablesMinor,
  };
}

export function budgetForMonth(snapshot: FinanceSnapshot, month: string): number {
  const budget = snapshot.budgets.find((item) => item.month === month);
  return budget?.amountMinor ?? snapshot.settings.monthlyBudgetMinor;
}

export function monthSummary(
  snapshot: FinanceSnapshot,
  month: string,
  now: Date = new Date(),
): MonthSummary {
  const range = monthRange(month);
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]));
  const txIds = new Set(
    activeTransactions(snapshot.transactions)
      .filter((tx) => tx.occurredAt >= range.fromIso && tx.occurredAt < range.toIso)
      .map((tx) => tx.id),
  );

  let incomeMinor = 0;
  let expenseMinor = 0;
  let refundMinor = 0;
  const byCategory = new Map<string, { amount: number; kind: Category['kind'] }>();

  for (const entry of snapshot.entries) {
    if (!entry.categoryId || !txIds.has(entry.transactionId)) continue;
    const category = categories.get(entry.categoryId);
    if (!category) continue;
    if (category.kind === 'income') {
      incomeMinor += -entry.amountMinor;
      const current = byCategory.get(category.id) ?? { amount: 0, kind: 'income' };
      current.amount += -entry.amountMinor;
      byCategory.set(category.id, current);
    } else {
      if (entry.amountMinor > 0) expenseMinor += entry.amountMinor;
      else refundMinor += -entry.amountMinor;
      const current = byCategory.get(category.id) ?? { amount: 0, kind: 'expense' };
      current.amount += entry.amountMinor;
      byCategory.set(category.id, current);
    }
  }

  const expenseByCategory: CategoryAmount[] = [];
  const incomeByCategory: CategoryAmount[] = [];
  for (const [categoryId, value] of byCategory) {
    const category = categories.get(categoryId);
    if (!category) continue;
    if (value.kind === 'expense' && value.amount !== 0) {
      expenseByCategory.push({
        categoryId,
        name: category.name,
        kind: 'expense',
        amountMinor: value.amount,
        share: expenseMinor > 0 ? Math.max(0, value.amount / expenseMinor) : 0,
      });
    }
    if (value.kind === 'income' && value.amount !== 0) {
      incomeByCategory.push({
        categoryId,
        name: category.name,
        kind: 'income',
        amountMinor: value.amount,
        share: incomeMinor > 0 ? Math.max(0, value.amount / incomeMinor) : 0,
      });
    }
  }
  expenseByCategory.sort((a, b) => b.amountMinor - a.amountMinor);
  incomeByCategory.sort((a, b) => b.amountMinor - a.amountMinor);

  const currentMonth = monthKey(now);
  const isCurrent = month === currentMonth;
  const isPast = month < currentMonth;
  const daysElapsed = isCurrent ? daysElapsedInMonth(now) : isPast ? daysInMonth(month) : 0;
  const daysRemaining = isCurrent ? daysRemainingInMonth(now) : 0;
  // Refunds are money returned for earlier purchases, not income. They still
  // reduce how much of the monthly budget was actually spent, so the budget,
  // the daily average and the forecast use net spending.
  const netSpentMinor = Math.max(0, expenseMinor - refundMinor);
  const averageDailyExpenseMinor =
    daysElapsed > 0 ? Math.round(netSpentMinor / daysElapsed) : 0;
  const forecastMonthEndExpenseMinor = isCurrent
    ? netSpentMinor + averageDailyExpenseMinor * daysRemaining
    : netSpentMinor;
  const budgetMinor = budgetForMonth(snapshot, month);
  const availableBudgetMinor = budgetMinor - netSpentMinor;

  return {
    month,
    incomeMinor,
    expenseMinor,
    refundMinor,
    netMinor: incomeMinor - expenseMinor,
    expenseByCategory,
    incomeByCategory,
    transactionCount: txIds.size,
    budgetMinor,
    availableBudgetMinor,
    budgetUsedPercent:
      budgetMinor > 0 ? Math.max(0, (netSpentMinor / budgetMinor) * 100) : 0,
    averageDailyExpenseMinor,
    forecastMonthEndExpenseMinor,
    daysElapsed,
    daysRemaining,
  };
}

export function upcomingPayments(
  snapshot: FinanceSnapshot,
  fromKey: string = todayKey(),
  horizonDays = 45,
): UpcomingPayment[] {
  const result: UpcomingPayment[] = [];

  for (const payment of snapshot.plannedPayments) {
    if (payment.deletedAt || !payment.active) continue;
    const dueDate = nextOccurrenceOfDay(payment.dayOfMonth, fromKey);
    const days = daysUntil(dueDate, fromKey);
    if (days < 0 || days > horizonDays) continue;
    result.push({
      id: `planned:${payment.id}`,
      name: payment.name,
      amountMinor: payment.amountMinor,
      dueDate,
      daysUntil: days,
      source: 'planned',
    });
  }

  for (const account of snapshot.accounts) {
    if (account.archived || account.type !== 'credit' || !account.paymentDueDay) continue;
    const balance = computeBalances(snapshot.accounts, snapshot.entries, snapshot.transactions).get(
      account.id,
    ) ?? 0;
    if (balance >= 0) continue;
    const dueDate = nextOccurrenceOfDay(account.paymentDueDay, fromKey);
    const days = daysUntil(dueDate, fromKey);
    if (days < 0 || days > horizonDays) continue;
    result.push({
      id: `credit:${account.id}`,
      name: `Платёж по кредитке «${account.name}»`,
      amountMinor: null,
      dueDate,
      daysUntil: days,
      source: 'credit',
    });
  }

  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'ru'));
}

export function nearestPayment(
  snapshot: FinanceSnapshot,
  fromKey: string = todayKey(),
): UpcomingPayment | null {
  return upcomingPayments(snapshot, fromKey)[0] ?? null;
}

export function nextInflow(
  inflows: PlannedInflow[],
  fromKey: string = todayKey(),
): NextInflow | null {
  const upcoming = inflows
    .filter((inflow) => !inflow.deletedAt && inflow.expectedDate >= fromKey)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const inflow = upcoming[0];
  if (!inflow) return null;
  return { inflow, daysUntil: daysUntil(inflow.expectedDate, fromKey) };
}

export function obligationsBefore(
  snapshot: FinanceSnapshot,
  dateKey: string,
  fromKey: string = todayKey(),
): number {
  return upcomingPayments(snapshot, fromKey, 365)
    .filter((payment) => payment.dueDate <= dateKey)
    .reduce((total, payment) => total + (payment.amountMinor ?? 0), 0);
}

export function purchaseAssessment(
  amountMinor: number,
  snapshot: FinanceSnapshot,
  now: Date = new Date(),
): PurchaseAssessment {
  const overview = moneyOverview(snapshot);
  const next = nextInflow(snapshot.plannedInflows, todayKey());
  const horizon = next ? next.inflow.expectedDate : monthRange(monthKey(now)).toIso.slice(0, 10);
  const obligations = obligationsBefore(snapshot, horizon);
  const afterPurchase = overview.ownFundsMinor - amountMinor;
  const afterObligations = afterPurchase - obligations;

  let level: PurchaseAssessment['level'] = 'good';
  let reason = 'Покупка не уводит баланс в минус и не мешает обязательным платежам.';
  if (afterObligations < 0) {
    level = 'danger';
    reason = next
      ? 'После покупки и обязательных платежей до ближайшего поступления не хватает денег.'
      : 'После покупки и обязательных платежей до конца месяца не хватает денег.';
  } else if (afterPurchase < overview.ownFundsMinor * 0.15) {
    level = 'warning';
    reason = 'Покупка оставит мало свободных денег на непредвиденные расходы.';
  }
  if (overview.ownFundsMinor < amountMinor) {
    level = 'danger';
    reason = 'Собственных денег меньше, чем стоит покупка. Кредитный лимит не считается своими деньгами.';
  }

  return {
    affordable: level !== 'danger',
    amountMinor,
    afterPurchaseMinor: afterPurchase,
    afterObligationsMinor: afterObligations,
    upcomingObligationsMinor: obligations,
    reason,
    level,
  };
}

export type Forecast = {
  averageDailyExpenseMinor: number;
  daysUntilNextInflow: number | null;
  projectedExpensesUntilInflowMinor: number;
  upcomingObligationsMinor: number;
  projectedBalanceUntilInflowMinor: number;
  runwayDays: number | null;
  nextInflow: NextInflow | null;
  upcomingPayment: UpcomingPayment | null;
  warning: string | null;
};

export function forecast(
  snapshot: FinanceSnapshot,
  month: string,
  now: Date = new Date(),
): Forecast {
  const summary = monthSummary(snapshot, month, now);
  const overview = moneyOverview(snapshot);
  const next = nextInflow(snapshot.plannedInflows, todayKey());
  const upcomingPayment = nearestPayment(snapshot);
  const avg = summary.averageDailyExpenseMinor;
  const daysUntilNextInflow = next?.daysUntil ?? null;
  const projectedExpenses = next ? avg * next.daysUntil : avg * summary.daysRemaining;
  const obligations = next
    ? obligationsBefore(snapshot, next.inflow.expectedDate)
    : obligationsBefore(snapshot, monthRange(month).toIso.slice(0, 10));
  const projectedBalance = overview.ownFundsMinor - projectedExpenses - obligations;
  const runwayDays = avg > 0 ? Math.floor(overview.ownFundsMinor / avg) : null;

  let warning: string | null = null;
  if (upcomingPayment && upcomingPayment.daysUntil <= 5) {
    if (upcomingPayment.amountMinor !== null && overview.liquidMinor < upcomingPayment.amountMinor) {
      warning = `Ближайший платёж ${upcomingPayment.dueDate}: не хватает ${formatMoney(
        upcomingPayment.amountMinor - overview.liquidMinor,
      )}.`;
    } else {
      warning = `Ближайший платёж ${upcomingPayment.dueDate} через ${upcomingPayment.daysUntil} дн.`;
    }
  }
  if (projectedBalance < 0 && !warning) {
    warning = 'При текущем темпе расходов денег может не хватить до следующего поступления.';
  }

  return {
    averageDailyExpenseMinor: avg,
    daysUntilNextInflow,
    projectedExpensesUntilInflowMinor: projectedExpenses,
    upcomingObligationsMinor: obligations,
    projectedBalanceUntilInflowMinor: projectedBalance,
    runwayDays,
    nextInflow: next,
    upcomingPayment,
    warning,
  };
}

export function goalProgress(goal: Goal): number {
  if (goal.targetMinor <= 0) return 0;
  return Math.max(0, Math.min(100, (goal.savedMinor / goal.targetMinor) * 100));
}

export function debtRemaining(debt: Debt): number {
  return Math.max(0, debt.amountMinor - debt.paidMinor);
}

export function transactionsInMonth(
  transactions: Transaction[],
  month: string,
): Transaction[] {
  const range = monthRange(month);
  return transactions
    .filter(
      (tx) =>
        !tx.deletedAt && tx.occurredAt >= range.fromIso && tx.occurredAt < range.toIso,
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function settingsDefaults(now = new Date()): AppSettings {
  const iso = now.toISOString();
  return {
    id: 'app',
    onboardingComplete: false,
    currency: 'RUB',
    monthlyBudgetMinor: 0,
    theme: 'system',
    createdAt: iso,
    updatedAt: iso,
  };
}
