import type { Db } from '../db.ts';
import { newId, nowIso, todayIsoDate } from '../lib/ids.ts';
import { assertMinor } from '../lib/money.ts';
import { audit } from '../lib/audit.ts';

export type CreditStatementRow = {
  id: string;
  user_id: string;
  account_id: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  grace_end_date: string | null;
  total_due_minor: number | null;
  min_payment_minor: number | null;
  paid_minor: number;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  rev: number;
};

export type CreditWarning = {
  level: 'info' | 'warning' | 'danger';
  code: string;
  message: string;
};

export type CreditOverview = {
  accounts: Array<{
    id: string;
    name: string;
    debtMinor: number;
    limitMinor: number | null;
    availableMinor: number | null;
    statementDay: number | null;
    paymentDueDay: number | null;
    statements: CreditStatementRow[];
    current: CreditStatementRow | null;
    daysUntilDue: number | null;
    paymentKnown: boolean;
    warnings: CreditWarning[];
  }>;
  warnings: CreditWarning[];
  paymentKnown: boolean;
  nextDueDate: string | null;
  totalDueKnownMinor: number;
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + 'T00:00:00Z');
  const to = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((to - from) / 86_400_000);
}

export function creditOverview(db: Db, userId: string, today = todayIsoDate()): CreditOverview {
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.credit_limit_minor, a.statement_day, a.payment_due_day,
              COALESCE(SUM(le.amount_minor), 0) AS balance
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id
       LEFT JOIN transactions t ON t.id = le.transaction_id AND t.deleted_at IS NULL
       WHERE a.user_id = ? AND a.type = 'credit' AND a.deleted_at IS NULL AND a.is_archived = 0
       GROUP BY a.id
       ORDER BY a.sort_order`,
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    credit_limit_minor: number | null;
    statement_day: number | null;
    payment_due_day: number | null;
    balance: number;
  }>;

  const allWarnings: CreditWarning[] = [];
  let paymentKnown = true;
  let nextDueDate: string | null = null;
  let totalDueKnownMinor = 0;

  const views = accounts.map((account) => {
    const statements = db
      .prepare(
        'SELECT * FROM credit_statements WHERE account_id = ? AND user_id = ? ORDER BY COALESCE(due_date, period_end) DESC',
      )
      .all(account.id, userId) as CreditStatementRow[];

    const current =
      statements.find((statement) => statement.status === 'open' || statement.status === 'overdue') ??
      statements[0] ??
      null;

    const warnings: CreditWarning[] = [];
    const debtMinor = Math.max(0, -Number(account.balance));
    const availableMinor =
      account.credit_limit_minor !== null ? Number(account.credit_limit_minor) - debtMinor : null;

    if (!current) {
      warnings.push({
        level: 'info',
        code: 'no_statement',
        message: 'Нет данных о выписке. Укажите дату и сумму платежа.',
      });
    } else {
      if (current.total_due_minor === null) {
        warnings.push({
          level: 'warning',
          code: 'amount_unknown',
          message: 'Сумма к оплате не указана. Расчёт помощника предварительный.',
        });
        paymentKnown = false;
      }
      if (current.grace_end_date === null) {
        warnings.push({
          level: 'info',
          code: 'grace_unknown',
          message: 'Льготный период не подтверждён.',
        });
      }
      if (current.due_date) {
        const days = daysBetween(today, current.due_date);
        if (days < 0 && current.status !== 'paid') {
          warnings.push({
            level: 'danger',
            code: 'overdue',
            message: `Платёж просрочен на ${Math.abs(days)} дн.`,
          });
        } else if (days <= 7 && current.status !== 'paid') {
          warnings.push({
            level: 'warning',
            code: 'due_soon',
            message: `Оплатить до ${current.due_date}: осталось ${days} дн.`,
          });
        }
        if (!nextDueDate || current.due_date < nextDueDate) nextDueDate = current.due_date;
      }
      if (current.total_due_minor !== null) {
        totalDueKnownMinor += Math.max(0, Number(current.total_due_minor) - Number(current.paid_minor));
      }
    }

    for (const warning of warnings) {
      if (!allWarnings.some((existing) => existing.code === warning.code)) allWarnings.push(warning);
    }

    return {
      id: account.id,
      name: account.name,
      debtMinor,
      limitMinor: account.credit_limit_minor === null ? null : Number(account.credit_limit_minor),
      availableMinor,
      statementDay: account.statement_day,
      paymentDueDay: account.payment_due_day,
      statements,
      current,
      daysUntilDue: current?.due_date ? daysBetween(today, current.due_date) : null,
      paymentKnown: current ? current.total_due_minor !== null : false,
      warnings,
    };
  });

  return {
    accounts: views,
    warnings: allWarnings,
    paymentKnown,
    nextDueDate,
    totalDueKnownMinor,
  };
}

export type StatementInput = {
  accountId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
  graceEndDate?: string | null;
  totalDueMinor?: number | null;
  minPaymentMinor?: number | null;
  paidMinor?: number;
  status?: 'open' | 'paid' | 'overdue' | 'unknown';
  note?: string | null;
};

export function createStatement(
  db: Db,
  userId: string,
  input: StatementInput,
): CreditStatementRow {
  const account = db
    .prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ? AND type = 'credit' AND deleted_at IS NULL")
    .get(input.accountId, userId);
  if (!account) throw new Error('Кредитный счёт не найден');
  if (input.totalDueMinor !== undefined && input.totalDueMinor !== null) {
    assertMinor(input.totalDueMinor);
    if (input.totalDueMinor < 0) throw new Error('Сумма к оплате не может быть отрицательной');
  }
  if (input.minPaymentMinor !== undefined && input.minPaymentMinor !== null) {
    assertMinor(input.minPaymentMinor);
  }

  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO credit_statements
     (id, user_id, account_id, period_start, period_end, due_date, grace_end_date,
      total_due_minor, min_payment_minor, paid_minor, status, note, created_at, updated_at, rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    userId,
    input.accountId,
    input.periodStart ?? null,
    input.periodEnd ?? null,
    input.dueDate ?? null,
    input.graceEndDate ?? null,
    input.totalDueMinor ?? null,
    input.minPaymentMinor ?? null,
    input.paidMinor ?? 0,
    input.status ?? 'open',
    input.note ?? null,
    now,
    now,
  );

  audit(db, {
    userId,
    action: 'credit.statement.create',
    entity: 'credit_statement',
    entityId: id,
    after: { accountId: input.accountId, dueDate: input.dueDate, totalDueMinor: input.totalDueMinor ?? null },
  });

  return db
    .prepare('SELECT * FROM credit_statements WHERE id = ?')
    .get(id) as CreditStatementRow;
}

export function updateStatement(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<Omit<StatementInput, 'accountId'>>,
): CreditStatementRow | null {
  const existing = db
    .prepare('SELECT * FROM credit_statements WHERE id = ? AND user_id = ?')
    .get(id, userId) as CreditStatementRow | undefined;
  if (!existing) return null;

  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  const assign = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.periodStart !== undefined) assign('period_start', patch.periodStart);
  if (patch.periodEnd !== undefined) assign('period_end', patch.periodEnd);
  if (patch.dueDate !== undefined) assign('due_date', patch.dueDate);
  if (patch.graceEndDate !== undefined) assign('grace_end_date', patch.graceEndDate);
  if (patch.totalDueMinor !== undefined) {
    if (patch.totalDueMinor !== null) assertMinor(patch.totalDueMinor);
    assign('total_due_minor', patch.totalDueMinor);
  }
  if (patch.minPaymentMinor !== undefined) {
    if (patch.minPaymentMinor !== null) assertMinor(patch.minPaymentMinor);
    assign('min_payment_minor', patch.minPaymentMinor);
  }
  if (patch.paidMinor !== undefined) assign('paid_minor', patch.paidMinor);
  if (patch.status !== undefined) assign('status', patch.status);
  if (patch.note !== undefined) assign('note', patch.note);

  if (fields.length === 0) return existing;
  assign('updated_at', nowIso());
  assign('rev', existing.rev + 1);
  values.push(id, userId);
  db.prepare(`UPDATE credit_statements SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

  audit(db, {
    userId,
    action: 'credit.statement.update',
    entity: 'credit_statement',
    entityId: id,
    before: { totalDueMinor: existing.total_due_minor, dueDate: existing.due_date },
    after: { totalDueMinor: patch.totalDueMinor ?? existing.total_due_minor, dueDate: patch.dueDate ?? existing.due_date },
  });

  return db.prepare('SELECT * FROM credit_statements WHERE id = ?').get(id) as CreditStatementRow;
}
