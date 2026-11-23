import type { Db } from '../db.ts';
import { addDaysToIsoDate, endOfMonthIsoDate, startOfMonthIsoDate, todayInZone } from '../lib/ids.ts';
import { accountSummary, listAccounts } from './accounts.ts';
import { creditOverview, type CreditWarning } from './credit.ts';
import { getSettings } from './settings.ts';
import { summary } from './transactions.ts';

export type InflowView = {
  id: string;
  name: string;
  amountMinor: number;
  confidence: string;
  expectedDate: string | null;
  windowStart: number | null;
  windowEnd: number | null;
  guaranteedBy: string;
  note: string | null;
};

type PlannedInflowRow = {
  id: string;
  name: string;
  amount_minor: number;
  expected_date: string | null;
  window_start: number | null;
  window_end: number | null;
  confidence: string;
  note: string | null;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}

function monthDate(isoDate: string, day: number): string {
  const [year, month] = isoDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), lastDay);
  return `${isoDate.slice(0, 7)}-${String(clamped).padStart(2, '0')}`;
}

function nextGuaranteedDate(row: PlannedInflowRow, today: string): string {
  if (row.expected_date) {
    if (row.expected_date >= today) return row.expected_date;
    const nextYear = `${Number(today.slice(0, 4)) + 1}${row.expected_date.slice(4)}`;
    return nextYear >= today ? nextYear : today;
  }
  if (row.window_start && row.window_end) {
    const end = monthDate(today, row.window_end);
    if (end >= today) return end;
    const nextMonth = addDaysToIsoDate(endOfMonthIsoDate(today), 1);
    return monthDate(nextMonth, row.window_end);
  }
  return endOfMonthIsoDate(today);
}

export function plannedInflows(db: Db, userId: string, today: string): {
  confirmed: InflowView[];
  excluded: InflowView[];
} {
  const rows = db
    .prepare('SELECT * FROM planned_inflows WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at')
    .all(userId) as PlannedInflowRow[];

  const mapped = rows.map((row) => ({
    id: row.id,
    name: row.name,
    amountMinor: Number(row.amount_minor),
    confidence: row.confidence,
    expectedDate: row.expected_date,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    guaranteedBy: nextGuaranteedDate(row, today),
    note: row.note,
  }));

  return {
    confirmed: mapped.filter((inflow) => inflow.confidence === 'confirmed'),
    excluded: mapped.filter((inflow) => inflow.confidence !== 'confirmed'),
  };
}

export type AssistantOverview = {
  today: string;
  status: 'ok' | 'provisional' | 'deficit';
  safePerDayMinor: number;
  knownAvailableMinor: number;
  spendableMinor: number;
  bufferMinor: number;
  knownCreditDueMinor: number;
  daysUntilInflow: number;
  horizonDate: string;
  nextInflow: InflowView | null;
  forecast: {
    horizonDate: string;
    expectedBalanceMinor: number;
    plannedSpendingMinor: number;
    inflowMinor: number;
    includesUnconfirmed: false;
    confidence: 'high' | 'medium' | 'low';
  };
  credit: {
    paymentKnown: boolean;
    debtMinor: number;
    totalDueKnownMinor: number;
    nextDueDate: string | null;
    warnings: CreditWarning[];
  };
  budget: {
    targetMinor: number;
    isTentative: boolean;
    spentThisMonthMinor: number;
  };
  excludedInflows: InflowView[];
  illiquidMinor: number;
  warnings: Array<{ code: string; message: string; level: 'info' | 'warning' | 'danger' }>;
  explanation: {
    formula: string;
    inputs: Record<string, string>;
    assumptions: string[];
    confidence: 'high' | 'medium' | 'low';
  };
};

export function assistantOverview(
  db: Db,
  userId: string,
  timezone = 'Europe/Moscow',
  today = todayInZone(timezone),
): AssistantOverview {
  const settings = getSettings(db, userId);
  const accounts = accountSummary(db, userId);
  const credit = creditOverview(db, userId, today);
  const inflows = plannedInflows(db, userId, today);
  const confirmed = [...inflows.confirmed].sort((a, b) => a.guaranteedBy.localeCompare(b.guaranteedBy));
  const nextInflow = confirmed[0] ?? null;
  const horizonDate = nextInflow?.guaranteedBy ?? endOfMonthIsoDate(today);
  const days = Math.max(1, daysBetween(today, horizonDate) + 1);

  const knownAvailable = accounts.spendableMinor - settings.bufferMinor - credit.totalDueKnownMinor;
  const safePerDay = Math.floor(knownAvailable / days);
  const status: AssistantOverview['status'] =
    knownAvailable <= 0 ? 'deficit' : credit.paymentKnown ? 'ok' : 'provisional';

  const monthStart = startOfMonthIsoDate(today);
  const monthSpent = summary(db, userId, monthStart + 'T00:00:00.000Z', today + 'T23:59:59.999Z').expenseMinor;
  const plannedSpending = Math.round((settings.budgetTargetMinor * days) / 30);
  const expectedBalance =
    accounts.spendableMinor + (nextInflow?.amountMinor ?? 0) - credit.totalDueKnownMinor - plannedSpending;

  const warnings: AssistantOverview['warnings'] = [];
  for (const warning of credit.warnings) {
    warnings.push({ code: warning.code, message: warning.message, level: warning.level });
  }
  if (!credit.paymentKnown) {
    warnings.push({
      code: 'credit_payment_unknown',
      message: 'Платёж по кредитке не указан — безопасная сумма предварительная.',
      level: 'warning',
    });
  }
  if (settings.budgetIsTentative) {
    warnings.push({
      code: 'budget_tentative',
      message: 'Бюджет 6 000 ₽ — редактируемый ориентир, а не гарантия.',
      level: 'info',
    });
  }
  if (inflows.confirmed.length === 0) {
    warnings.push({
      code: 'no_confirmed_inflow',
      message: 'Нет подтверждённого поступления. Горизонт — до конца месяца.',
      level: 'warning',
    });
  }
  if (accounts.illiquidMinor > 0) {
    warnings.push({
      code: 'illiquid_excluded',
      message: 'Steam-инвентарь не входит в доступные средства.',
      level: 'info',
    });
  }
  for (const inflow of inflows.excluded) {
    warnings.push({
      code: 'unconfirmed_inflow',
      message: `«${inflow.name}» ${(inflow.amountMinor / 100).toFixed(0)} ₽ не учитывается как доход.`,
      level: 'info',
    });
  }

  const confidence: AssistantOverview['explanation']['confidence'] = !credit.paymentKnown
    ? 'low'
    : settings.budgetIsTentative || inflows.excluded.length > 0
      ? 'medium'
      : 'high';

  const assumptions = [
    'Учитываются только ликвидные счета: наличные, дебет, накопления.',
    'Кредитный лимит не считается деньгами.',
    'Неликвидные активы (Steam) не участвуют.',
    nextInflow
      ? `«${nextInflow.name}» ${(nextInflow.amountMinor / 100).toFixed(0)} ₽ считается подтверждённым и ожидается не позднее ${horizonDate}.`
      : 'Подтверждённых поступлений нет.',
  ];
  if (!credit.paymentKnown) assumptions.push('Сумма платежа по кредитке неизвестна, поэтому оценка осторожная.');
  for (const inflow of inflows.excluded) assumptions.push(`«${inflow.name}» не учитывается, пока не пришёл.`);

  return {
    today,
    status,
    safePerDayMinor: safePerDay,
    knownAvailableMinor: knownAvailable,
    spendableMinor: accounts.spendableMinor,
    bufferMinor: settings.bufferMinor,
    knownCreditDueMinor: credit.totalDueKnownMinor,
    daysUntilInflow: days,
    horizonDate,
    nextInflow,
    forecast: {
      horizonDate,
      expectedBalanceMinor: expectedBalance,
      plannedSpendingMinor: plannedSpending,
      inflowMinor: nextInflow?.amountMinor ?? 0,
      includesUnconfirmed: false,
      confidence,
    },
    credit: {
      paymentKnown: credit.paymentKnown,
      debtMinor: credit.accounts.reduce((total, account) => total + account.debtMinor, 0),
      totalDueKnownMinor: credit.totalDueKnownMinor,
      nextDueDate: credit.nextDueDate,
      warnings: credit.warnings,
    },
    budget: {
      targetMinor: settings.budgetTargetMinor,
      isTentative: settings.budgetIsTentative,
      spentThisMonthMinor: monthSpent,
    },
    excludedInflows: inflows.excluded,
    illiquidMinor: accounts.illiquidMinor,
    warnings,
    explanation: {
      formula:
        'безопасно в день = (ликвидные − резерв − известные платежи по кредиткам) / дни до гарантированного поступления',
      inputs: {
        spendable: String(accounts.spendableMinor),
        buffer: String(settings.bufferMinor),
        knownCreditDue: String(credit.totalDueKnownMinor),
        days: String(days),
        horizonDate,
      },
      assumptions,
      confidence,
    },
  };
}

export type AffordResult = {
  verdict: 'ok' | 'risky' | 'no';
  amountMinor: number;
  accountId: string | null;
  remainingAfterMinor: number;
  safePerDayMinor: number;
  daysUntilInflow: number;
  reasons: string[];
  warnings: string[];
  usedCreditLimit: false;
  explanation: string;
};

export function afford(
  db: Db,
  userId: string,
  amountMinor: number,
  accountId: string | null,
  timezone = 'Europe/Moscow',
): AffordResult {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Сумма покупки должна быть больше нуля');
  }
  const overview = assistantOverview(db, userId, timezone);
  const accounts = listAccounts(db, userId);
  const account = accountId ? accounts.find((item) => item.id === accountId) : null;
  if (accountId && !account) throw new Error('Счёт не найден');

  const reasons: string[] = [];
  const warnings = overview.warnings.map((warning) => warning.message);
  let verdict: AffordResult['verdict'] = 'ok';

  if (account && account.type === 'credit') {
    warnings.push('Оплата кредиткой увеличит долг. Лимит не считается доступными деньгами.');
  }

  const available = overview.knownAvailableMinor;
  const remaining = available - amountMinor;

  if (account && ['cash', 'debit', 'savings'].includes(account.type) && account.balanceMinor < amountMinor) {
    verdict = 'no';
    reasons.push(`На счёте «${account.name}» недостаточно средств.`);
  } else if (remaining < 0) {
    verdict = 'no';
    reasons.push('После покупки не останется денег на резерв и известные платежи.');
  } else if (!overview.credit.paymentKnown) {
    verdict = 'risky';
    reasons.push('Платёж по кредитке не указан: реальная безопасная сумма может быть меньше.');
  } else if (amountMinor > overview.safePerDayMinor) {
    verdict = 'risky';
    reasons.push(
      `Это больше безопасной суммы на день (${(overview.safePerDayMinor / 100).toFixed(0)} ₽). Придётся урезать другие траты.`,
    );
  } else {
    reasons.push('Покупка укладывается в безопасный остаток на день.');
  }

  if (overview.status === 'deficit') {
    verdict = 'no';
    reasons.push('Сейчас дефицит: доступных средств меньше резерва и платежей.');
  }

  return {
    verdict,
    amountMinor,
    accountId: accountId ?? null,
    remainingAfterMinor: remaining,
    safePerDayMinor: overview.safePerDayMinor,
    daysUntilInflow: overview.daysUntilInflow,
    reasons,
    warnings,
    usedCreditLimit: false,
    explanation: `Доступно ${(available / 100).toFixed(2)} ₽, покупка ${(amountMinor / 100).toFixed(2)} ₽, останется ${(remaining / 100).toFixed(2)} ₽. Горизонт — ${overview.daysUntilInflow} дн. до ${overview.horizonDate}.`,
  };
}

export type AllocationLine = {
  priority: number;
  target: 'credit' | 'buffer' | 'budget' | 'free';
  label: string;
  amountMinor: number;
  reason: string;
};

export type AllocationResult = {
  amountMinor: number;
  lines: AllocationLine[];
  warnings: string[];
  explanation: string;
};

export function allocate(
  db: Db,
  userId: string,
  amountMinor: number,
  timezone = 'Europe/Moscow',
): AllocationResult {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Сумма распределения должна быть больше нуля');
  }
  const overview = assistantOverview(db, userId, timezone);
  const settings = getSettings(db, userId);
  const lines: AllocationLine[] = [];
  const warnings = overview.warnings.map((warning) => warning.message);
  let remaining = amountMinor;

  const creditDue = overview.knownCreditDueMinor;
  if (creditDue > 0) {
    const amount = Math.min(remaining, creditDue);
    if (amount > 0) {
      lines.push({
        priority: 1,
        target: 'credit',
        label: 'Платёж по кредитке',
        amountMinor: amount,
        reason: 'Ближайший обязательный платёж имеет приоритет.',
      });
      remaining -= amount;
    }
  } else if (!overview.credit.paymentKnown) {
    warnings.push('Сумма платежа по кредитке неизвестна — уточните её до распределения.');
  }

  const bufferGap = Math.max(0, settings.bufferMinor - overview.spendableMinor);
  if (remaining > 0 && bufferGap > 0) {
    const amount = Math.min(remaining, bufferGap);
    lines.push({
      priority: 2,
      target: 'buffer',
      label: 'Пополнение резерва',
      amountMinor: amount,
      reason: `Резерв ${(settings.bufferMinor / 100).toFixed(0)} ₽ защищает от неожиданностей.`,
    });
    remaining -= amount;
  }

  const budgetGap = Math.max(0, settings.budgetTargetMinor - overview.budget.spentThisMonthMinor);
  if (remaining > 0 && budgetGap > 0) {
    const amount = Math.min(remaining, budgetGap);
    lines.push({
      priority: 3,
      target: 'budget',
      label: 'Текущие расходы',
      amountMinor: amount,
      reason: 'Покрывает оставшуюся часть бюджета на месяц.',
    });
    remaining -= amount;
  }

  if (remaining > 0) {
    lines.push({
      priority: 4,
      target: 'free',
      label: 'Свободно',
      amountMinor: remaining,
      reason: 'Обязательства и резерв покрыты.',
    });
    remaining = 0;
  }

  return {
    amountMinor,
    lines,
    warnings,
    explanation: `Распределение ${(amountMinor / 100).toFixed(2)} ₽: сначала обязательный платёж, затем резерв, затем текущий бюджет. Неподтверждённые поступления не используются.`,
  };
}
