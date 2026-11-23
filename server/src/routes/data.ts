import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { newId, nowIso, startOfMonthIsoDate, todayInZone } from '../lib/ids.ts';
import {
  accountSummary,
  createAccount,
  findCategoryByName,
  getAccount,
  listAccounts,
  updateAccount,
} from '../services/accounts.ts';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  summary,
  transactionHistory,
  updateTransaction,
  type TxKind,
} from '../services/transactions.ts';
import {
  applyTemplate,
  createTemplate,
  deleteTemplate,
  listTemplates,
} from '../services/templates.ts';
import { fail, requireAuth } from './auth.ts';

const money = z
  .union([z.string().regex(/^-?\d+$/), z.number().int()])
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value), 'Сумма должна быть целым числом копеек');

const dateString = z
  .string()
  .min(10)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Некорректная дата');

const txKind = z.enum([
  'expense',
  'income',
  'transfer',
  'credit_payment',
  'debt_payment',
  'refund',
  'adjustment',
]);

const transactionSchema = z
  .object({
    kind: txKind,
    amountMinor: money,
    occurredAt: dateString.optional(),
    description: z.string().max(500).optional(),
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    fromAccountId: z.string().min(1).optional(),
    toAccountId: z.string().min(1).optional(),
    receivableAccountId: z.string().min(1).optional(),
    source: z
      .enum(['manual', 'voice', 'sms', 'csv', 'recurring', 'shortcut', 'template', 'seed'])
      .optional(),
    reviewStatus: z.enum(['ok', 'needs_review', 'duplicate_suspect', 'ignored']).optional(),
  })
  .strict();

const accountSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: z.enum([
      'cash',
      'debit',
      'savings',
      'credit',
      'receivable',
      'payable',
      'asset_illiquid',
      'investment',
    ]),
    creditLimitMinor: money.nullable().optional(),
    interestRateBp: z.number().int().min(0).max(100_000).nullable().optional(),
    statementDay: z.number().int().min(1).max(31).nullable().optional(),
    paymentDueDay: z.number().int().min(1).max(31).nullable().optional(),
    isLiquid: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
    sortOrder: z.number().int().optional(),
    openingBalanceMinor: money.optional(),
  })
  .strict();

const accountPatchSchema = accountSchema.omit({ openingBalanceMinor: true }).partial().extend({
  isArchived: z.boolean().optional(),
});

const templateSchema = z
  .object({
    name: z.string().min(1).max(80),
    kind: z.enum(['expense', 'income']),
    amountMinor: money,
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    icon: z.string().max(8).nullable().optional(),
  })
  .strict();

export function registerDataRoutes(app: FastifyInstance, db: Db, config: Config): void {
  app.get('/api/accounts', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const accounts = listAccounts(db, auth.userId);
    return {
      accounts: accounts.map((account) => ({
        ...account,
        balanceMinor: String(account.balanceMinor),
        availableLimitMinor:
          account.availableLimitMinor === null ? null : String(account.availableLimitMinor),
      })),
      summary: Object.fromEntries(
        Object.entries(accountSummary(db, auth.userId)).map(([key, value]) => [key, String(value)]),
      ),
    };
  });

  app.post('/api/accounts', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = accountSchema.parse(request.body ?? {});
    const account = createAccount(db, auth.userId, body);
    audit(db, {
      userId: auth.userId,
      action: 'account.create',
      entity: 'account',
      entityId: account.id,
      after: { name: account.name, type: account.type },
    });

    if (body.openingBalanceMinor && body.openingBalanceMinor !== 0) {
      const category =
        findCategoryByName(db, auth.userId, 'Стартовый баланс') ??
        findCategoryByName(db, auth.userId, 'Корректировка');
      if (!category) throw new Error('Нет категории для стартового баланса');
      createTransaction(db, auth.userId, {
        kind: 'adjustment',
        amountMinor: body.openingBalanceMinor,
        accountId: account.id,
        categoryId: category.id,
        description: 'Стартовый баланс (введено вручную)',
        source: 'seed',
      });
    }

    return { ok: true, accountId: account.id };
  });

  app.patch('/api/accounts/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const before = getAccount(db, auth.userId, id);
    if (!before) return fail(reply, 404, 'NOT_FOUND', 'Счёт не найден');
    const body = accountPatchSchema.parse(request.body ?? {});
    const account = updateAccount(db, auth.userId, id, body);
    audit(db, {
      userId: auth.userId,
      action: 'account.update',
      entity: 'account',
      entityId: id,
      before: { name: before.name, note: before.note },
      after: { name: account?.name, note: account?.note },
    });
    return { ok: true };
  });

  app.get('/api/categories', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const categories = db
      .prepare(
        `SELECT id, name, kind, parent_id, icon, color, is_system, sort_order, monthly_target_minor
         FROM categories WHERE user_id = ? AND deleted_at IS NULL ORDER BY kind, sort_order`,
      )
      .all(auth.userId);
    return { categories };
  });

  app.get('/api/transactions', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const query = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        kind: txKind.optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        includeDeleted: z.coerce.boolean().optional(),
      })
      .parse(request.query ?? {});

    const result = listTransactions(db, auth.userId, {
      from: query.from,
      to: query.to,
      kind: query.kind,
      limit: query.limit,
      offset: query.offset,
      includeDeleted: query.includeDeleted,
    });
    return {
      total: result.total,
      items: result.items.map(serializeTransaction),
    };
  });

  app.get('/api/transactions/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const transaction = getTransaction(db, auth.userId, id);
    if (!transaction) return fail(reply, 404, 'NOT_FOUND', 'Операция не найдена');
    return {
      transaction: serializeTransaction(transaction),
      history: transactionHistory(db, auth.userId, id),
    };
  });

  app.post('/api/transactions', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = transactionSchema.parse(request.body ?? {});
    const transaction = createTransaction(db, auth.userId, body, { requestId: request.id });
    return { ok: true, transaction: serializeTransaction(transaction) };
  });

  app.patch('/api/transactions/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const body = transactionSchema.parse(request.body ?? {});
    const transaction = updateTransaction(db, auth.userId, id, body, { requestId: request.id });
    if (!transaction) return fail(reply, 404, 'NOT_FOUND', 'Операция не найдена');
    return { ok: true, transaction: serializeTransaction(transaction) };
  });

  app.delete('/api/transactions/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const ok = deleteTransaction(db, auth.userId, id, { requestId: request.id });
    if (!ok) return fail(reply, 404, 'NOT_FOUND', 'Операция не найдена');
    return { ok: true, undoToken: id };
  });

  app.post('/api/transactions/:id/restore', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const ok = restoreTransaction(db, auth.userId, id, { requestId: request.id });
    if (!ok) return fail(reply, 404, 'NOT_FOUND', 'Нечего восстанавливать');
    return { ok: true };
  });

  app.get('/api/reports/summary', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const query = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(request.query ?? {});
    const today = todayInZone(config.timezone);
    const from = normalizeFrom(query.from ?? startOfMonthIsoDate(today));
    const to = normalizeTo(query.to ?? today);
    return serializeSummary(summary(db, auth.userId, from, to));
  });

  app.get('/api/templates', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    return { templates: listTemplates(db, auth.userId).map(serializeTemplate) };
  });

  app.post('/api/templates', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = templateSchema.parse(request.body ?? {});
    const template = createTemplate(db, auth.userId, body);
    return { ok: true, template: serializeTemplate(template) };
  });

  app.delete('/api/templates/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    if (!deleteTemplate(db, auth.userId, id)) return fail(reply, 404, 'NOT_FOUND', 'Шаблон не найден');
    return { ok: true };
  });

  app.post('/api/templates/:id/apply', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const body = z
      .object({ occurredAt: dateString.optional() })
      .strict()
      .parse(request.body ?? {});
    const transaction = applyTemplate(db, auth.userId, id, body.occurredAt);
    if (!transaction) return fail(reply, 404, 'NOT_FOUND', 'Шаблон не найден');
    return { ok: true, transaction: serializeTransaction(transaction) };
  });

  app.get('/api/audit', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const query = z
      .object({
        entity: z.string().max(40).optional(),
        entityId: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query ?? {});
    const where = ['user_id = ?'];
    const params: Array<string | number> = [auth.userId];
    if (query.entity) {
      where.push('entity = ?');
      params.push(query.entity);
    }
    if (query.entityId) {
      where.push('entity_id = ?');
      params.push(query.entityId);
    }
    const rows = db
      .prepare(
        `SELECT id, at, actor, action, entity, entity_id, before_json, after_json
         FROM audit_log WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`,
      )
      .all(...params, query.limit ?? 50) as Array<{
      id: string;
      at: string;
      actor: string;
      action: string;
      entity: string;
      entity_id: string | null;
      before_json: string | null;
      after_json: string | null;
    }>;
    return {
      items: rows.map((row) => ({
        id: row.id,
        at: row.at,
        actor: row.actor,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        before: row.before_json ? JSON.parse(row.before_json) : null,
        after: row.after_json ? JSON.parse(row.after_json) : null,
      })),
    };
  });
}

function serializeTransaction(transaction: ReturnType<typeof getTransaction>) {
  if (!transaction) return null;
  return {
    ...transaction,
    totalMinor: String(transaction.totalMinor),
    entries: transaction.entries.map((entry) => ({
      ...entry,
      amountMinor: String(entry.amountMinor),
    })),
  };
}

function serializeTemplate(template: ReturnType<typeof listTemplates>[number]) {
  return {
    ...template,
    amount_minor: String(template.amount_minor),
  };
}

function serializeSummary(value: ReturnType<typeof summary>) {
  return {
    ...value,
    incomeMinor: String(value.incomeMinor),
    expenseMinor: String(value.expenseMinor),
    netMinor: String(value.netMinor),
    byCategory: value.byCategory.map((category) => ({
      ...category,
      amountMinor: String(category.amountMinor),
    })),
  };
}

function normalizeFrom(value: string): string {
  return value.length === 10 ? `${value}T00:00:00.000Z` : new Date(value).toISOString();
}

function normalizeTo(value: string): string {
  return value.length === 10 ? `${value}T23:59:59.999Z` : new Date(value).toISOString();
}
