import type { Db } from '../db.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { assertMinor } from '../lib/money.ts';

export type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  currency: string;
  credit_limit_minor: number | null;
  interest_rate_bp: number | null;
  statement_day: number | null;
  payment_due_day: number | null;
  is_liquid: number;
  is_archived: number;
  sort_order: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type AccountView = AccountRow & {
  balanceMinor: number;
  availableLimitMinor: number | null;
};

export type AccountSummary = {
  spendableMinor: number;
  receivableMinor: number;
  creditDebtMinor: number;
  creditAvailableMinor: number;
  illiquidMinor: number;
  netLiquidMinor: number;
  netWorthMinor: number;
};

const SPENDABLE_TYPES = new Set(['cash', 'debit', 'savings']);

export function listAccounts(db: Db, userId: string): AccountView[] {
  const rows = db
    .prepare(
      `SELECT * FROM accounts
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY is_archived, sort_order, created_at`,
    )
    .all(userId) as AccountRow[];

  const balances = balanceMap(db, userId);
  return rows.map((row) => {
    const balanceMinor = balances.get(row.id) ?? 0;
    return {
      ...row,
      balanceMinor,
      availableLimitMinor:
        row.type === 'credit' && row.credit_limit_minor !== null
          ? row.credit_limit_minor + balanceMinor
          : null,
    };
  });
}

export function balanceMap(db: Db, userId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT le.account_id AS account_id, SUM(le.amount_minor) AS total
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND le.account_id IS NOT NULL
       GROUP BY le.account_id`,
    )
    .all(userId) as Array<{ account_id: string; total: number }>;
  return new Map(rows.map((row) => [row.account_id, Number(row.total)]));
}

export function accountSummary(db: Db, userId: string): AccountSummary {
  const accounts = listAccounts(db, userId).filter((account) => !account.is_archived);
  let spendable = 0;
  let receivable = 0;
  let creditDebt = 0;
  let creditAvailable = 0;
  let illiquid = 0;

  for (const account of accounts) {
    if (account.type === 'credit') {
      if (account.balanceMinor < 0) creditDebt += -account.balanceMinor;
      if (account.availableLimitMinor !== null) creditAvailable += account.availableLimitMinor;
      continue;
    }
    if (account.type === 'receivable') {
      receivable += account.balanceMinor;
      continue;
    }
    if (!account.is_liquid || account.type === 'asset_illiquid') {
      illiquid += account.balanceMinor;
      continue;
    }
    if (SPENDABLE_TYPES.has(account.type)) spendable += account.balanceMinor;
  }

  const netLiquid = spendable + receivable - creditDebt;
  return {
    spendableMinor: spendable,
    receivableMinor: receivable,
    creditDebtMinor: creditDebt,
    creditAvailableMinor: creditAvailable,
    illiquidMinor: illiquid,
    netLiquidMinor: netLiquid,
    netWorthMinor: netLiquid + illiquid,
  };
}

export function getAccount(db: Db, userId: string, accountId: string): AccountRow | null {
  const row = db
    .prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(accountId, userId) as AccountRow | undefined;
  return row ?? null;
}

export type CreateAccountInput = {
  name: string;
  type: string;
  creditLimitMinor?: number | null;
  interestRateBp?: number | null;
  statementDay?: number | null;
  paymentDueDay?: number | null;
  isLiquid?: boolean;
  note?: string | null;
  sortOrder?: number;
};

const ACCOUNT_TYPES = new Set([
  'cash',
  'debit',
  'savings',
  'credit',
  'receivable',
  'payable',
  'asset_illiquid',
  'investment',
]);

export function createAccount(db: Db, userId: string, input: CreateAccountInput): AccountRow {
  if (!ACCOUNT_TYPES.has(input.type)) throw new Error('Неизвестный тип счёта');
  if (input.type === 'credit' && !input.creditLimitMinor) {
    throw new Error('Для кредитного счёта нужен лимит');
  }
  if (input.creditLimitMinor !== undefined && input.creditLimitMinor !== null) {
    assertMinor(input.creditLimitMinor);
    if (input.creditLimitMinor <= 0) throw new Error('Лимит должен быть положительным');
  }

  const now = nowIso();
  const id = newId();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM accounts WHERE user_id = ?')
    .get(userId) as { max_order: number };

  db.prepare(
    `INSERT INTO accounts
     (id, user_id, name, type, currency, credit_limit_minor, interest_rate_bp, statement_day, payment_due_day, is_liquid, sort_order, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'RUB', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    input.name.trim().slice(0, 80),
    input.type,
    input.creditLimitMinor ?? null,
    input.interestRateBp ?? null,
    input.statementDay ?? null,
    input.paymentDueDay ?? null,
    input.isLiquid === false || input.type === 'credit' || input.type === 'asset_illiquid' ? 0 : 1,
    input.sortOrder ?? Number(maxOrder.max_order) + 1,
    input.note ?? null,
    now,
    now,
  );

  return getAccount(db, userId, id)!;
}

export function updateAccount(
  db: Db,
  userId: string,
  accountId: string,
  patch: Partial<CreateAccountInput> & { isArchived?: boolean },
): AccountRow | null {
  const existing = getAccount(db, userId, accountId);
  if (!existing) return null;

  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  const assign = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.name !== undefined) assign('name', patch.name.trim().slice(0, 80));
  if (patch.creditLimitMinor !== undefined) {
    if (patch.creditLimitMinor !== null) assertMinor(patch.creditLimitMinor);
    assign('credit_limit_minor', patch.creditLimitMinor);
  }
  if (patch.interestRateBp !== undefined) assign('interest_rate_bp', patch.interestRateBp);
  if (patch.statementDay !== undefined) assign('statement_day', patch.statementDay);
  if (patch.paymentDueDay !== undefined) assign('payment_due_day', patch.paymentDueDay);
  if (patch.isLiquid !== undefined) assign('is_liquid', patch.isLiquid ? 1 : 0);
  if (patch.isArchived !== undefined) assign('is_archived', patch.isArchived ? 1 : 0);
  if (patch.note !== undefined) assign('note', patch.note);
  if (patch.sortOrder !== undefined) assign('sort_order', patch.sortOrder);

  if (fields.length === 0) return existing;
  assign('updated_at', nowIso());
  values.push(accountId, userId);
  db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
  return getAccount(db, userId, accountId);
}

export function findCategoryByName(
  db: Db,
  userId: string,
  name: string,
): { id: string; kind: string } | null {
  const row = db
    .prepare(
      'SELECT id, kind FROM categories WHERE user_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1',
    )
    .get(userId, name) as { id: string; kind: string } | undefined;
  return row ?? null;
}
