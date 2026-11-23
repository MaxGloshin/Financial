import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { audit } from '../lib/audit.ts';
import { todayInZone } from '../lib/ids.ts';
import {
  afford,
  allocate,
  assistantOverview,
  type AssistantOverview,
} from '../services/assistant.ts';
import { creditOverview, createStatement, updateStatement } from '../services/credit.ts';
import { getSettings, updateSettings } from '../services/settings.ts';
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

const statementSchema = z
  .object({
    accountId: z.string().min(1),
    periodStart: dateString.nullable().optional(),
    periodEnd: dateString.nullable().optional(),
    dueDate: dateString.nullable().optional(),
    graceEndDate: dateString.nullable().optional(),
    totalDueMinor: money.nullable().optional(),
    minPaymentMinor: money.nullable().optional(),
    paidMinor: money.optional(),
    status: z.enum(['open', 'paid', 'overdue', 'unknown']).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

const statementPatchSchema = statementSchema.omit({ accountId: true }).partial();

export function registerAssistantRoutes(app: FastifyInstance, db: Db, config: Config): void {
  app.get('/api/credit', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const overview = creditOverview(db, auth.userId, todayInZone(config.timezone));
    return {
      ...overview,
      totalDueKnownMinor: String(overview.totalDueKnownMinor),
      accounts: overview.accounts.map((account) => ({
        ...account,
        debtMinor: String(account.debtMinor),
        limitMinor: account.limitMinor === null ? null : String(account.limitMinor),
        availableMinor: account.availableMinor === null ? null : String(account.availableMinor),
        statements: account.statements.map(serializeStatement),
      })),
    };
  });

  app.post('/api/credit/statements', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = statementSchema.parse(request.body ?? {});
    const statement = createStatement(db, auth.userId, body);
    return { ok: true, statement: serializeStatement(statement) };
  });

  app.patch('/api/credit/statements/:id', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const { id } = request.params as { id: string };
    const body = statementPatchSchema.parse(request.body ?? {});
    const statement = updateStatement(db, auth.userId, id, body);
    if (!statement) return fail(reply, 404, 'NOT_FOUND', 'Выписка не найдена');
    return { ok: true, statement: serializeStatement(statement) };
  });

  app.get('/api/assistant/overview', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const overview = assistantOverview(db, auth.userId, config.timezone);
    return serializeOverview(overview);
  });

  app.post('/api/assistant/afford', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = z
      .object({
        amountMinor: money,
        accountId: z.string().min(1).nullable().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const result = afford(db, auth.userId, body.amountMinor, body.accountId ?? null, config.timezone);
    return {
      ...result,
      amountMinor: String(result.amountMinor),
      remainingAfterMinor: String(result.remainingAfterMinor),
      safePerDayMinor: String(result.safePerDayMinor),
    };
  });

  app.post('/api/assistant/allocate', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = z.object({ amountMinor: money }).strict().parse(request.body ?? {});
    const result = allocate(db, auth.userId, body.amountMinor, config.timezone);
    return {
      ...result,
      amountMinor: String(result.amountMinor),
      lines: result.lines.map((line) => ({ ...line, amountMinor: String(line.amountMinor) })),
    };
  });

  app.get('/api/settings', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    return { settings: getSettings(db, auth.userId) };
  });

  app.put('/api/settings', async (request, reply) => {
    const auth = requireAuth(request, reply, db, config);
    if (!auth) return;
    const body = z
      .object({
        budgetTargetMinor: money.optional(),
        budgetIsTentative: z.boolean().optional(),
        bufferMinor: money.optional(),
        lockTimeoutMinutes: z.number().int().optional(),
        theme: z.enum(['system', 'light', 'dark']).optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const settings = updateSettings(db, auth.userId, body);
    audit(db, {
      userId: auth.userId,
      action: 'settings.update',
      entity: 'settings',
      entityId: null,
      after: settings,
    });
    return { ok: true, settings };
  });
}

function serializeStatement(statement: {
  total_due_minor: number | null;
  min_payment_minor: number | null;
  paid_minor: number;
  [key: string]: unknown;
}) {
  return {
    ...statement,
    total_due_minor: statement.total_due_minor === null ? null : String(statement.total_due_minor),
    min_payment_minor:
      statement.min_payment_minor === null ? null : String(statement.min_payment_minor),
    paid_minor: String(statement.paid_minor),
  };
}

function serializeOverview(overview: AssistantOverview) {
  const inflow = (value: AssistantOverview['nextInflow']) =>
    value === null ? null : { ...value, amountMinor: String(value.amountMinor) };

  return {
    ...overview,
    safePerDayMinor: String(overview.safePerDayMinor),
    knownAvailableMinor: String(overview.knownAvailableMinor),
    spendableMinor: String(overview.spendableMinor),
    bufferMinor: String(overview.bufferMinor),
    knownCreditDueMinor: String(overview.knownCreditDueMinor),
    illiquidMinor: String(overview.illiquidMinor),
    nextInflow: inflow(overview.nextInflow),
    excludedInflows: overview.excludedInflows.map((item) => ({
      ...item,
      amountMinor: String(item.amountMinor),
    })),
    forecast: {
      ...overview.forecast,
      expectedBalanceMinor: String(overview.forecast.expectedBalanceMinor),
      plannedSpendingMinor: String(overview.forecast.plannedSpendingMinor),
      inflowMinor: String(overview.forecast.inflowMinor),
    },
    credit: {
      ...overview.credit,
      debtMinor: String(overview.credit.debtMinor),
      totalDueKnownMinor: String(overview.credit.totalDueKnownMinor),
    },
    budget: {
      ...overview.budget,
      targetMinor: String(overview.budget.targetMinor),
      spentThisMonthMinor: String(overview.budget.spentThisMonthMinor),
    },
  };
}
