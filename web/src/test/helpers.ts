import { createFinanceDb, type FinanceDB } from '@/db/db.ts';
import { ensureBaseData } from '@/db/defaults.ts';
import type { FinanceSnapshot } from '@/domain/finance.ts';
import { settingsDefaults } from '@/domain/finance.ts';

export async function openTestDb(): Promise<FinanceDB> {
  const database = createFinanceDb(`pf-test-${crypto.randomUUID()}`);
  await database.open();
  await ensureBaseData(database);
  return database;
}

export async function readSnapshot(database: FinanceDB): Promise<FinanceSnapshot> {
  const [
    accounts,
    categories,
    transactions,
    entries,
    debts,
    goals,
    plannedPayments,
    plannedInflows,
    budgets,
    settingsRows,
  ] = await Promise.all([
    database.accounts.toArray(),
    database.categories.toArray(),
    database.transactions.toArray(),
    database.entries.toArray(),
    database.debts.toArray(),
    database.goals.toArray(),
    database.plannedPayments.toArray(),
    database.plannedInflows.toArray(),
    database.budgets.toArray(),
    database.settings.toArray(),
  ]);
  return {
    accounts,
    categories,
    transactions,
    entries,
    debts,
    goals,
    plannedPayments,
    plannedInflows,
    budgets,
    settings: settingsRows[0] ?? settingsDefaults(),
  };
}
