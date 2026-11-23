import type { Db } from '../db.ts';
import { withTransaction } from '../db.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { assertMinor } from '../lib/money.ts';
import { audit } from '../lib/audit.ts';
import type { AccountRow } from './accounts.ts';
import { getAccount } from './accounts.ts';

export type TxKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'credit_payment'
  | 'debt_payment'
  | 'refund'
  | 'adjustment';

export type TransactionInput = {
  kind: TxKind;
  amountMinor: number;
  occurredAt?: string;
  description?: string;
  accountId?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  receivableAccountId?: string;
  source?: string;
  reviewStatus?: 'ok' | 'needs_review' | 'duplicate_suspect' | 'ignored';
};

export type LedgerEntryView = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryKind: string | null;
  amountMinor: number;
};

export type TransactionView = {
  id: string;
  kind: TxKind;
  occurredAt: string;
  description: string;
  source: string;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
  deletedAt: string | null;
  entries: LedgerEntryView[];
  totalMinor: number;
};

type CategoryRow = {
  id: string;
  name: string;
  kind: string;
};

const KIND_LABEL: Record<TxKind, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  credit_payment: 'Платёж по кредитке',
  debt_payment: 'Возврат долга',
  refund: 'Возврат',
  adjustment: 'Корректировка',
};

function category(db: Db, userId: string, categoryId: string, expectedKind?: string): CategoryRow {
  const row = db
    .prepare('SELECT id, name, kind FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(categoryId, userId) as CategoryRow | undefined;
  if (!row) throw new Error('Категория не найдена');
  if (expectedKind && row.kind !== expectedKind) {
    throw new Error(`Категория «${row.name}» не подходит для этой операции`);
  }
  return row;
}

function requireAccount(db: Db, userId: string, accountId: string | undefined, role: string): AccountRow {
  if (!accountId) throw new Error(`Не указан счёт (${role})`);
  const account = getAccount(db, userId, accountId);
  if (!account) throw new Error('Счёт не найден');
  return account;
}

type EntryDraft = {
  accountId: string | null;
  categoryId: string | null;
  amountMinor: number;
};

function buildEntries(db: Db, userId: string, input: TransactionInput): EntryDraft[] {
  const amount = input.amountMinor;
  if (!Number.isSafeInteger(amount)) throw new Error('Сумма должна быть в целых копейках');
  if (input.kind !== 'adjustment' && amount <= 0) throw new Error('Сумма должна быть больше нуля');
  if (input.kind === 'adjustment' && amount === 0) throw new Error('Сумма не может быть нулевой');

  switch (input.kind) {
    case 'expense': {
      const account = requireAccount(db, userId, input.accountId, 'списание');
      const cat = category(db, userId, input.categoryId ?? '', 'expense');
      return [
        { accountId: account.id, categoryId: null, amountMinor: -amount },
        { accountId: null, categoryId: cat.id, amountMinor: amount },
      ];
    }
    case 'income': {
      const account = requireAccount(db, userId, input.accountId, 'зачисление');
      if (account.type === 'credit') throw new Error('Доход нельзя зачислить на кредитный счёт');
      const cat = category(db, userId, input.categoryId ?? '', 'income');
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: cat.id, amountMinor: -amount },
      ];
    }
    case 'refund': {
      const account = requireAccount(db, userId, input.accountId, 'возврат');
      const cat = category(db, userId, input.categoryId ?? '', 'expense');
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: cat.id, amountMinor: -amount },
      ];
    }
    case 'transfer': {
      const from = requireAccount(db, userId, input.fromAccountId, 'списание');
      const to = requireAccount(db, userId, input.toAccountId, 'зачисление');
      if (from.id === to.id) throw new Error('Нельзя перевести на тот же счёт');
      return [
        { accountId: from.id, categoryId: null, amountMinor: -amount },
        { accountId: to.id, categoryId: null, amountMinor: amount },
      ];
    }
    case 'credit_payment': {
      const from = requireAccount(db, userId, input.fromAccountId, 'списание');
      const credit = requireAccount(db, userId, input.toAccountId, 'кредитка');
      if (from.id === credit.id) throw new Error('Нельзя погасить кредитку с неё же');
      if (credit.type !== 'credit') throw new Error('Целевой счёт должен быть кредитным');
      if (!['cash', 'debit', 'savings'].includes(from.type)) {
        throw new Error('Погашать кредитку можно только со своего счёта');
      }
      return [
        { accountId: from.id, categoryId: null, amountMinor: -amount },
        { accountId: credit.id, categoryId: null, amountMinor: amount },
      ];
    }
    case 'debt_payment': {
      const receivable = requireAccount(db, userId, input.receivableAccountId, 'долг мне');
      const to = requireAccount(db, userId, input.toAccountId, 'зачисление');
      if (receivable.type !== 'receivable') throw new Error('Счёт долга должен быть типа «мне должны»');
      if (!['cash', 'debit', 'savings'].includes(to.type)) {
        throw new Error('Возврат долга можно зачислить только на свой счёт');
      }
      return [
        { accountId: receivable.id, categoryId: null, amountMinor: -amount },
        { accountId: to.id, categoryId: null, amountMinor: amount },
      ];
    }
    case 'adjustment': {
      const account = requireAccount(db, userId, input.accountId, 'корректировка');
      let cat: CategoryRow;
      if (input.categoryId) {
        cat = category(db, userId, input.categoryId, 'adjustment');
      } else {
        const row = db
          .prepare(
            "SELECT id, name, kind FROM categories WHERE user_id = ? AND kind = 'adjustment' AND name = 'Корректировка' AND deleted_at IS NULL",
          )
          .get(userId) as CategoryRow | undefined;
        if (!row) throw new Error('Нет системной категории корректировки');
        cat = row;
      }
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: cat.id, amountMinor: -amount },
      ];
    }
    default:
      throw new Error('Неизвестный тип операции');
  }
}

export function createTransaction(
  db: Db,
  userId: string,
  input: TransactionInput,
  meta: { requestId?: string | null; actor?: string } = {},
): TransactionView {
  const entries = buildEntries(db, userId, input);
  const sum = entries.reduce((total, entry) => total + entry.amountMinor, 0);
  if (sum !== 0) throw new Error('Внутренняя ошибка: проводки не сбалансированы');

  const id = newId();
  const now = nowIso();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : now;
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new Error('Некорректная дата операции');
  const description =
    (input.description ?? '').trim().slice(0, 500) || KIND_LABEL[input.kind];

  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO transactions
       (id, user_id, kind, occurred_at, description, source, review_status, created_at, updated_at, rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      id,
      userId,
      input.kind,
      occurredAt,
      description,
      input.source ?? 'manual',
      input.reviewStatus ?? 'ok',
      now,
      now,
    );

    for (const entry of entries) {
      assertMinor(entry.amountMinor);
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, category_id, amount_minor)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId(), id, entry.accountId, entry.categoryId, entry.amountMinor);
    }

    audit(db, {
      userId,
      actor: meta.actor ?? 'user',
      action: 'transaction.create',
      entity: 'transaction',
      entityId: id,
      after: { kind: input.kind, amountMinor: input.amountMinor, occurredAt, description },
      requestId: meta.requestId,
    });
  });

  return getTransaction(db, userId, id)!;
}

export function getTransaction(db: Db, userId: string, id: string): TransactionView | null {
  const row = db
    .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(id, userId) as
    | {
        id: string;
        kind: TxKind;
        occurred_at: string;
        description: string;
        source: string;
        review_status: string;
        created_at: string;
        updated_at: string;
        rev: number;
        deleted_at: string | null;
      }
    | undefined;
  if (!row) return null;

  const entries = db
    .prepare(
      `SELECT le.id, le.account_id, le.category_id, le.amount_minor,
              a.name AS account_name, c.name AS category_name, c.kind AS category_kind
       FROM ledger_entries le
       LEFT JOIN accounts a ON a.id = le.account_id
       LEFT JOIN categories c ON c.id = le.category_id
       WHERE le.transaction_id = ?
       ORDER BY le.amount_minor DESC`,
    )
    .all(id) as Array<{
    id: string;
    account_id: string | null;
    category_id: string | null;
    amount_minor: number;
    account_name: string | null;
    category_name: string | null;
    category_kind: string | null;
  }>;

  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    description: row.description,
    source: row.source,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rev: row.rev,
    deletedAt: row.deleted_at,
    entries: entries.map((entry) => ({
      id: entry.id,
      accountId: entry.account_id,
      accountName: entry.account_name,
      categoryId: entry.category_id,
      categoryName: entry.category_name,
      categoryKind: entry.category_kind,
      amountMinor: Number(entry.amount_minor),
    })),
    totalMinor: Math.max(...entries.map((entry) => Math.abs(Number(entry.amount_minor)))),
  };
}

export type ListFilter = {
  from?: string;
  to?: string;
  kind?: TxKind;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
};

export function listTransactions(
  db: Db,
  userId: string,
  filter: ListFilter = {},
): { items: TransactionView[]; total: number } {
  const where = ['t.user_id = ?'];
  const params: Array<string | number> = [userId];

  if (!filter.includeDeleted) where.push('t.deleted_at IS NULL');
  if (filter.from) {
    where.push('t.occurred_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('t.occurred_at <= ?');
    params.push(filter.to);
  }
  if (filter.kind) {
    where.push('t.kind = ?');
    params.push(filter.kind);
  }

  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${where.join(' AND ')}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT t.id FROM transactions t
       WHERE ${where.join(' AND ')}
       ORDER BY t.occurred_at DESC, t.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{ id: string }>;

  return {
    items: rows.map((row) => getTransaction(db, userId, row.id)!).filter(Boolean),
    total: Number(totalRow.count),
  };
}

export function updateTransaction(
  db: Db,
  userId: string,
  id: string,
  input: TransactionInput,
  meta: { requestId?: string | null } = {},
): TransactionView | null {
  const existing = getTransaction(db, userId, id);
  if (!existing || existing.deletedAt) return null;

  const entries = buildEntries(db, userId, input);
  if (entries.reduce((total, entry) => total + entry.amountMinor, 0) !== 0) {
    throw new Error('Внутренняя ошибка: проводки не сбалансированы');
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : existing.occurredAt;
  const description = (input.description ?? '').trim().slice(0, 500) || existing.description;

  withTransaction(db, () => {
    db.prepare('DELETE FROM ledger_entries WHERE transaction_id = ?').run(id);
    db.prepare(
      `UPDATE transactions
       SET kind = ?, occurred_at = ?, description = ?, updated_at = ?, rev = rev + 1
       WHERE id = ? AND user_id = ?`,
    ).run(input.kind, occurredAt, description, nowIso(), id, userId);

    for (const entry of entries) {
      assertMinor(entry.amountMinor);
      db.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, category_id, amount_minor)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId(), id, entry.accountId, entry.categoryId, entry.amountMinor);
    }

    audit(db, {
      userId,
      action: 'transaction.update',
      entity: 'transaction',
      entityId: id,
      before: { kind: existing.kind, entries: existing.entries.map((entry) => entry.amountMinor) },
      after: { kind: input.kind, entries: entries.map((entry) => entry.amountMinor) },
      requestId: meta.requestId,
    });
  });

  return getTransaction(db, userId, id);
}

export function deleteTransaction(
  db: Db,
  userId: string,
  id: string,
  meta: { requestId?: string | null } = {},
): boolean {
  const existing = getTransaction(db, userId, id);
  if (!existing || existing.deletedAt) return false;
  db.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ?, rev = rev + 1 WHERE id = ? AND user_id = ?').run(
    nowIso(),
    nowIso(),
    id,
    userId,
  );
  audit(db, {
    userId,
    action: 'transaction.delete',
    entity: 'transaction',
    entityId: id,
    before: { kind: existing.kind, description: existing.description },
    requestId: meta.requestId,
  });
  return true;
}

export function restoreTransaction(
  db: Db,
  userId: string,
  id: string,
  meta: { requestId?: string | null } = {},
): boolean {
  const row = db
    .prepare('SELECT deleted_at FROM transactions WHERE id = ? AND user_id = ?')
    .get(id, userId) as { deleted_at: string | null } | undefined;
  if (!row || !row.deleted_at) return false;
  db.prepare('UPDATE transactions SET deleted_at = NULL, updated_at = ?, rev = rev + 1 WHERE id = ? AND user_id = ?').run(
    nowIso(),
    id,
    userId,
  );
  audit(db, {
    userId,
    action: 'transaction.restore',
    entity: 'transaction',
    entityId: id,
    requestId: meta.requestId,
  });
  return true;
}

export type Summary = {
  from: string;
  to: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  byCategory: Array<{
    categoryId: string;
    name: string;
    kind: string;
    amountMinor: number;
  }>;
  count: number;
};

export function summary(db: Db, userId: string, from: string, to: string): Summary {
  const rows = db
    .prepare(
      `SELECT c.id AS category_id, c.name, c.kind, SUM(le.amount_minor) AS total
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       JOIN categories c ON c.id = le.category_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL
         AND t.occurred_at >= ? AND t.occurred_at <= ?
         AND c.kind IN ('income', 'expense')
       GROUP BY c.id, c.name, c.kind
       ORDER BY ABS(SUM(le.amount_minor)) DESC`,
    )
    .all(userId, from, to) as Array<{
    category_id: string;
    name: string;
    kind: string;
    total: number;
  }>;

  let income = 0;
  let expense = 0;
  const byCategory = rows.map((row) => {
    const raw = Number(row.total);
    if (row.kind === 'income') income += -raw;
    if (row.kind === 'expense') expense += raw;
    return {
      categoryId: row.category_id,
      name: row.name,
      kind: row.kind,
      amountMinor: row.kind === 'income' ? -raw : raw,
    };
  });

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE user_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?`,
    )
    .get(userId, from, to) as { count: number };

  return {
    from,
    to,
    incomeMinor: income,
    expenseMinor: expense,
    netMinor: income - expense,
    byCategory,
    count: Number(countRow.count),
  };
}

export function transactionHistory(db: Db, userId: string, id: string) {
  const rows = db
    .prepare(
      `SELECT at, action, actor, before_json, after_json FROM audit_log
       WHERE user_id = ? AND entity = 'transaction' AND entity_id = ?
       ORDER BY at DESC LIMIT 50`,
    )
    .all(userId, id) as Array<{
    at: string;
    action: string;
    actor: string;
    before_json: string | null;
    after_json: string | null;
  }>;
  return rows.map((row) => ({
    at: row.at,
    action: row.action,
    actor: row.actor,
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
  }));
}
