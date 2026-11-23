import type {
  Account,
  Category,
  Debt,
  LedgerEntry,
  Transaction,
  TransactionDraft,
} from '../domain/types.ts';
import {
  assertBalanced,
  buildPostings,
  type PostingContext,
  transactionKindLabel,
} from '../domain/postings.ts';
import { nowIso } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { assertMinor } from '../lib/money.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

async function loadContext(database: FinanceDB): Promise<PostingContext> {
  const [accounts, categories, debts] = await Promise.all([
    database.accounts.toArray(),
    database.categories.toArray(),
    database.debts.toArray(),
  ]);
  return {
    accounts: new Map(accounts.map((item) => [item.id, item])),
    categories: new Map(categories.map((item) => [item.id, item])),
    debts: new Map(debts.map((item) => [item.id, item])),
  };
}

function normalizeDraft(draft: TransactionDraft): TransactionDraft {
  const occurredAt = draft.occurredAt ? new Date(draft.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Некорректная дата операции');
  if (!Number.isSafeInteger(draft.amountMinor)) {
    throw new Error('Сумма должна быть в целых копейках');
  }
  assertMinor(draft.amountMinor);
  if (draft.kind !== 'adjustment' && draft.amountMinor <= 0) {
    throw new Error('Сумма должна быть больше нуля');
  }
  return {
    ...draft,
    amountMinor: draft.amountMinor,
    occurredAt: occurredAt.toISOString(),
    description: (draft.description ?? '').trim().slice(0, 500),
  };
}

function debtApplied(tx: Transaction): boolean {
  return tx.kind === 'debt_payment' && Boolean(tx.debtId) && !tx.deletedAt;
}

async function applyDebtDelta(
  database: FinanceDB,
  debtId: string,
  deltaMinor: number,
): Promise<void> {
  if (deltaMinor === 0) return;
  const debt = await database.debts.get(debtId);
  if (!debt) throw new Error('Долг не найден');
  const paid = debt.paidMinor + deltaMinor;
  if (paid < 0) throw new Error('Нельзя вернуть больше, чем было выплачено по долгу');
  if (paid > debt.amountMinor) throw new Error('Сумма больше остатка долга');
  await database.debts.put({
    ...debt,
    paidMinor: paid,
    status: paid >= debt.amountMinor ? 'paid' : 'open',
    updatedAt: nowIso(),
  });
}

function txSnapshot(tx: Transaction) {
  return {
    kind: tx.kind,
    amountMinor: tx.amountMinor,
    occurredAt: tx.occurredAt,
    description: tx.description,
    accountId: tx.accountId,
    fromAccountId: tx.fromAccountId,
    toAccountId: tx.toAccountId,
    categoryId: tx.categoryId,
    debtId: tx.debtId,
  };
}

export async function createTransaction(
  database: FinanceDB,
  draft: TransactionDraft,
): Promise<Transaction> {
  const normalized = normalizeDraft(draft);
  const clientRequestId = draft.clientRequestId?.trim() || newId();

  return database.transaction(
    'rw',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.entries,
      database.debts,
      database.audit,
    ],
    async () => {
      // Idempotency: a repeated submit returns the already created operation.
      const existing = await database.transactions
        .where('clientRequestId')
        .equals(clientRequestId)
        .first();
      if (existing) return existing;

      const context = await loadContext(database);
      const postings = buildPostings(normalized, context);
      if (['expense', 'income', 'refund', 'transfer', 'credit_payment'].includes(normalized.kind)) {
        assertBalanced(postings);
      }

      const now = nowIso();
      const transaction: Transaction = {
        id: newId(),
        kind: normalized.kind,
        amountMinor: normalized.amountMinor,
        occurredAt: normalized.occurredAt!,
        description:
          normalized.description || transactionKindLabel(normalized.kind),
        accountId: normalized.accountId,
        fromAccountId: normalized.fromAccountId,
        toAccountId: normalized.toAccountId,
        categoryId: normalized.categoryId,
        debtId: normalized.debtId,
        clientRequestId,
        source: normalized.source ?? 'manual',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        rev: 1,
      };

      await database.transactions.add(transaction);
      const entries: LedgerEntry[] = postings.map((posting) => ({
        id: newId(),
        transactionId: transaction.id,
        accountId: posting.accountId,
        categoryId: posting.categoryId,
        amountMinor: posting.amountMinor,
      }));
      await database.entries.bulkAdd(entries);

      if (transaction.kind === 'debt_payment' && transaction.debtId) {
        await applyDebtDelta(database, transaction.debtId, transaction.amountMinor);
      }

      await database.audit.add(
        auditRecord('transaction.create', 'transaction', transaction.id, undefined, txSnapshot(transaction)),
      );
      return transaction;
    },
  );
}

export async function updateTransaction(
  database: FinanceDB,
  id: string,
  draft: TransactionDraft,
): Promise<Transaction> {
  const normalized = normalizeDraft(draft);

  return database.transaction(
    'rw',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.entries,
      database.debts,
      database.audit,
    ],
    async () => {
      const existing = await database.transactions.get(id);
      if (!existing) throw new Error('Операция не найдена');
      if (existing.deletedAt) throw new Error('Операция уже удалена');

      const context = await loadContext(database);
      // When editing the same debt payment, validate against debt without the old payment.
      if (debtApplied(existing) && existing.debtId) {
        const debt = context.debts.get(existing.debtId);
        if (debt) {
          const revertedPaid = Math.max(0, debt.paidMinor - existing.amountMinor);
          context.debts.set(debt.id, {
            ...debt,
            paidMinor: revertedPaid,
            status: revertedPaid >= debt.amountMinor ? 'paid' : 'open',
          });
        }
      }

      const postings = buildPostings(normalized, context);
      if (['expense', 'income', 'refund', 'transfer', 'credit_payment'].includes(normalized.kind)) {
        assertBalanced(postings);
      }

      const next: Transaction = {
        ...existing,
        kind: normalized.kind,
        amountMinor: normalized.amountMinor,
        occurredAt: normalized.occurredAt!,
        description:
          normalized.description || transactionKindLabel(normalized.kind),
        accountId: normalized.accountId,
        fromAccountId: normalized.fromAccountId,
        toAccountId: normalized.toAccountId,
        categoryId: normalized.categoryId,
        debtId: normalized.debtId,
        updatedAt: nowIso(),
        rev: existing.rev + 1,
      };

      // Revert old debt effect, then apply the new one in the same transaction.
      if (debtApplied(existing) && existing.debtId) {
        await applyDebtDelta(database, existing.debtId, -existing.amountMinor);
      }
      await database.entries.where('transactionId').equals(id).delete();
      await database.transactions.put(next);
      await database.entries.bulkAdd(
        postings.map((posting) => ({
          id: newId(),
          transactionId: id,
          accountId: posting.accountId,
          categoryId: posting.categoryId,
          amountMinor: posting.amountMinor,
        })),
      );
      if (next.kind === 'debt_payment' && next.debtId) {
        await applyDebtDelta(database, next.debtId, next.amountMinor);
      }

      await database.audit.add(
        auditRecord('transaction.update', 'transaction', id, txSnapshot(existing), txSnapshot(next)),
      );
      return next;
    },
  );
}

export async function deleteTransaction(database: FinanceDB, id: string): Promise<Transaction> {
  return database.transaction(
    'rw',
    [database.transactions, database.debts, database.audit],
    async () => {
      const existing = await database.transactions.get(id);
      if (!existing) throw new Error('Операция не найдена');
      if (existing.deletedAt) return existing;
      const next: Transaction = {
        ...existing,
        deletedAt: nowIso(),
        updatedAt: nowIso(),
        rev: existing.rev + 1,
      };
      await database.transactions.put(next);
      if (debtApplied(existing) && existing.debtId) {
        await applyDebtDelta(database, existing.debtId, -existing.amountMinor);
      }
      await database.audit.add(
        auditRecord('transaction.delete', 'transaction', id, txSnapshot(existing), undefined),
      );
      return next;
    },
  );
}

export async function restoreTransaction(database: FinanceDB, id: string): Promise<Transaction> {
  return database.transaction(
    'rw',
    [database.transactions, database.debts, database.audit],
    async () => {
      const existing = await database.transactions.get(id);
      if (!existing) throw new Error('Операция не найдена');
      if (!existing.deletedAt) return existing;
      if (existing.kind === 'debt_payment' && existing.debtId) {
        const debt = await database.debts.get(existing.debtId);
        if (!debt) throw new Error('Долг не найден');
        if (debt.paidMinor + existing.amountMinor > debt.amountMinor) {
          throw new Error('Нельзя восстановить: по долгу уже есть другие платежи');
        }
      }
      const next: Transaction = {
        ...existing,
        deletedAt: null,
        updatedAt: nowIso(),
        rev: existing.rev + 1,
      };
      await database.transactions.put(next);
      if (next.kind === 'debt_payment' && next.debtId) {
        await applyDebtDelta(database, next.debtId, next.amountMinor);
      }
      await database.audit.add(
        auditRecord('transaction.restore', 'transaction', id, undefined, txSnapshot(next)),
      );
      return next;
    },
  );
}

/** Used by import/merge only. Replaces the aggregate in one atomic step. */
export async function replaceTransactionRows(
  database: FinanceDB,
  transactions: Transaction[],
  entries: LedgerEntry[],
): Promise<void> {
  await database.transaction('rw', database.transactions, database.entries, async () => {
    await database.transactions.clear();
    await database.entries.clear();
    await database.transactions.bulkPut(transactions);
    await database.entries.bulkPut(entries);
  });
}

export type TransactionDetail = {
  transaction: Transaction;
  entries: LedgerEntry[];
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
};

export async function getTransactionDetail(
  database: FinanceDB,
  id: string,
): Promise<TransactionDetail | null> {
  const transaction = await database.transactions.get(id);
  if (!transaction) return null;
  const [entries, accounts, categories] = await Promise.all([
    database.entries.where('transactionId').equals(id).toArray(),
    database.accounts.toArray(),
    database.categories.toArray(),
  ]);
  return {
    transaction,
    entries,
    accounts: new Map(accounts.map((item) => [item.id, item])),
    categories: new Map(categories.map((item) => [item.id, item])),
  };
}

export async function countTransactions(database: FinanceDB): Promise<number> {
  return database.transactions.count();
}

export type { Debt };
