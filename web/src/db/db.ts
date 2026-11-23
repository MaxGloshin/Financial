import Dexie, { type Table } from 'dexie';
import type {
  Account,
  AppSettings,
  AuditLog,
  Budget,
  Category,
  Debt,
  Goal,
  LedgerEntry,
  PlannedInflow,
  PlannedPayment,
  Transaction,
} from '../domain/types.ts';

export class FinanceDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  entries!: Table<LedgerEntry, string>;
  debts!: Table<Debt, string>;
  goals!: Table<Goal, string>;
  plannedPayments!: Table<PlannedPayment, string>;
  plannedInflows!: Table<PlannedInflow, string>;
  budgets!: Table<Budget, string>;
  settings!: Table<AppSettings, string>;
  audit!: Table<AuditLog, string>;

  constructor(name = 'personal-finance') {
    super(name);
    this.version(1).stores({
      accounts: 'id, type, archived, sortOrder, updatedAt',
      categories: 'id, kind, sortOrder, name',
      transactions:
        'id, occurredAt, kind, accountId, fromAccountId, toAccountId, categoryId, debtId, &clientRequestId, deletedAt, updatedAt',
      entries: 'id, transactionId, accountId, categoryId',
      debts: 'id, direction, status, dueDate, updatedAt, deletedAt',
      goals: 'id, deadline, updatedAt, deletedAt',
      plannedPayments: 'id, dayOfMonth, active, updatedAt, deletedAt',
      plannedInflows: 'id, expectedDate, confidence, updatedAt, deletedAt',
      budgets: 'month, updatedAt',
      settings: 'id',
      audit: 'id, at, entity, entityId',
    });
  }
}

export const db = new FinanceDB();

export function createFinanceDb(name: string): FinanceDB {
  return new FinanceDB(name);
}

export const ALL_TABLE_NAMES = [
  'accounts',
  'categories',
  'transactions',
  'entries',
  'debts',
  'goals',
  'plannedPayments',
  'plannedInflows',
  'budgets',
  'settings',
  'audit',
] as const;

export type TableName = (typeof ALL_TABLE_NAMES)[number];

export async function clearFinancialData(database: FinanceDB): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.entries,
      database.debts,
      database.goals,
      database.plannedPayments,
      database.plannedInflows,
      database.budgets,
      database.settings,
      database.audit,
    ],
    async () => {
      await Promise.all(ALL_TABLE_NAMES.map((name) => database.table(name).clear()));
    },
  );
}
