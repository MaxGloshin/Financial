import type { Db } from '../db.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { assertMinor } from '../lib/money.ts';
import { audit } from '../lib/audit.ts';
import { createTransaction, type TransactionView } from './transactions.ts';
import { getAccount } from './accounts.ts';

export type TemplateRow = {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  amount_minor: number;
  account_id: string | null;
  category_id: string | null;
  icon: string | null;
  sort_order: number;
  usage_count: number;
  created_at: string;
  deleted_at: string | null;
};

export type TemplateView = TemplateRow & {
  accountName: string | null;
  categoryName: string | null;
};

export function listTemplates(db: Db, userId: string): TemplateView[] {
  const rows = db
    .prepare(
      `SELECT t.*, a.name AS account_name, c.name AS category_name
       FROM templates t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL
       ORDER BY t.sort_order, t.created_at`,
    )
    .all(userId) as Array<TemplateRow & { account_name: string | null; category_name: string | null }>;
  return rows.map((row) => ({
    ...row,
    amount_minor: Number(row.amount_minor),
    accountName: row.account_name,
    categoryName: row.category_name,
  }));
}

export type CreateTemplateInput = {
  name: string;
  kind: 'expense' | 'income';
  amountMinor: number;
  accountId: string;
  categoryId: string;
  icon?: string | null;
};

export function createTemplate(db: Db, userId: string, input: CreateTemplateInput): TemplateView {
  assertMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error('Сумма шаблона должна быть больше нуля');
  if (input.kind !== 'expense' && input.kind !== 'income') {
    throw new Error('Шаблон поддерживает только расход и доход');
  }
  const account = getAccount(db, userId, input.accountId);
  if (!account) throw new Error('Счёт не найден');
  const category = db
    .prepare('SELECT id, kind FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(input.categoryId, userId) as { id: string; kind: string } | undefined;
  if (!category) throw new Error('Категория не найдена');
  if (category.kind !== input.kind) throw new Error('Категория не соответствует типу шаблона');

  const id = newId();
  const now = nowIso();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM templates WHERE user_id = ?')
    .get(userId) as { max_order: number };

  db.prepare(
    `INSERT INTO templates
     (id, user_id, name, kind, amount_minor, account_id, category_id, icon, sort_order, usage_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    id,
    userId,
    input.name.trim().slice(0, 80),
    input.kind,
    input.amountMinor,
    input.accountId,
    input.categoryId,
    input.icon ?? null,
    Number(maxOrder.max_order) + 1,
    now,
  );

  audit(db, {
    userId,
    action: 'template.create',
    entity: 'template',
    entityId: id,
    after: { name: input.name, amountMinor: input.amountMinor, kind: input.kind },
  });

  return listTemplates(db, userId).find((template) => template.id === id)!;
}

export function deleteTemplate(db: Db, userId: string, id: string): boolean {
  const row = db
    .prepare('SELECT id FROM templates WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId);
  if (!row) return false;
  db.prepare('UPDATE templates SET deleted_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), id, userId);
  audit(db, {
    userId,
    action: 'template.delete',
    entity: 'template',
    entityId: id,
  });
  return true;
}

export function applyTemplate(
  db: Db,
  userId: string,
  id: string,
  occurredAt?: string,
): TransactionView | null {
  const row = db
    .prepare('SELECT * FROM templates WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(id, userId) as TemplateRow | undefined;
  if (!row) return null;

  const transaction = createTransaction(db, userId, {
    kind: row.kind as 'expense' | 'income',
    amountMinor: Number(row.amount_minor),
    occurredAt,
    description: row.name,
    accountId: row.account_id ?? undefined,
    categoryId: row.category_id ?? undefined,
    source: 'template',
  });

  db.prepare('UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?').run(id);
  return transaction;
}
