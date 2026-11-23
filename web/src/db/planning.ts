import type {
  Budget,
  Debt,
  DebtDirection,
  Goal,
  InflowConfidence,
  PlannedInflow,
  PlannedPayment,
} from '../domain/types.ts';
import { nowIso, isValidDateKey, monthKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { assertMinor } from '../lib/money.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

/* ----------------------------- Debts ----------------------------- */

export type DebtInput = {
  direction: DebtDirection;
  counterparty: string;
  amountMinor: number;
  dueDate?: string | null;
  note?: string;
};

export async function createDebt(database: FinanceDB, input: DebtInput): Promise<Debt> {
  if (!input.counterparty.trim()) throw new Error('Укажите, кому или кто должен');
  assertMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error('Сумма долга должна быть больше нуля');
  if (input.dueDate && !isValidDateKey(input.dueDate)) throw new Error('Некорректная дата');
  return database.transaction('rw', database.debts, database.audit, async () => {
    const now = nowIso();
    const debt: Debt = {
      id: newId(),
      direction: input.direction,
      counterparty: input.counterparty.trim().slice(0, 120),
      amountMinor: input.amountMinor,
      paidMinor: 0,
      dueDate: input.dueDate ?? null,
      note: input.note?.trim().slice(0, 500),
      status: 'open',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await database.debts.add(debt);
    await database.audit.add(auditRecord('debt.create', 'debt', debt.id, undefined, debtSnapshot(debt)));
    return debt;
  });
}

export async function updateDebt(
  database: FinanceDB,
  id: string,
  patch: Partial<DebtInput> & { paidMinor?: number },
): Promise<Debt> {
  return database.transaction('rw', database.debts, database.audit, async () => {
    const existing = await database.debts.get(id);
    if (!existing) throw new Error('Долг не найден');
    const amountMinor = patch.amountMinor ?? existing.amountMinor;
    const paidMinor = patch.paidMinor ?? existing.paidMinor;
    assertMinor(amountMinor);
    assertMinor(paidMinor);
    if (amountMinor <= 0) throw new Error('Сумма долга должна быть больше нуля');
    if (paidMinor < 0 || paidMinor > amountMinor) throw new Error('Выплачено не может быть больше долга');
    if (patch.dueDate && !isValidDateKey(patch.dueDate)) throw new Error('Некорректная дата');
    const next: Debt = {
      ...existing,
      direction: patch.direction ?? existing.direction,
      counterparty: (patch.counterparty ?? existing.counterparty).trim().slice(0, 120),
      amountMinor,
      paidMinor,
      dueDate: patch.dueDate === undefined ? existing.dueDate : patch.dueDate,
      note: patch.note === undefined ? existing.note : patch.note.trim().slice(0, 500),
      status: paidMinor >= amountMinor ? 'paid' : 'open',
      updatedAt: nowIso(),
    };
    if (!next.counterparty) throw new Error('Укажите, кому или кто должен');
    await database.debts.put(next);
    await database.audit.add(
      auditRecord('debt.update', 'debt', id, debtSnapshot(existing), debtSnapshot(next)),
    );
    return next;
  });
}

export async function deleteDebt(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.debts, database.audit, async () => {
    const existing = await database.debts.get(id);
    if (!existing) throw new Error('Долг не найден');
    await database.debts.put({ ...existing, deletedAt: nowIso(), updatedAt: nowIso() });
    await database.audit.add(auditRecord('debt.delete', 'debt', id, debtSnapshot(existing), undefined));
  });
}

function debtSnapshot(debt: Debt) {
  return {
    direction: debt.direction,
    counterparty: debt.counterparty,
    amountMinor: debt.amountMinor,
    paidMinor: debt.paidMinor,
    dueDate: debt.dueDate,
  };
}

/* ----------------------------- Goals ----------------------------- */

export type GoalInput = {
  name: string;
  targetMinor: number;
  savedMinor?: number;
  deadline?: string | null;
  note?: string;
  color?: string;
};

export async function createGoal(database: FinanceDB, input: GoalInput): Promise<Goal> {
  if (!input.name.trim()) throw new Error('Введите название цели');
  assertMinor(input.targetMinor);
  if (input.targetMinor <= 0) throw new Error('Цель должна быть больше нуля');
  if (input.deadline && !isValidDateKey(input.deadline)) throw new Error('Некорректная дата');
  return database.transaction('rw', database.goals, database.audit, async () => {
    const now = nowIso();
    const goal: Goal = {
      id: newId(),
      name: input.name.trim().slice(0, 100),
      targetMinor: input.targetMinor,
      savedMinor: input.savedMinor ?? 0,
      deadline: input.deadline ?? null,
      note: input.note?.trim().slice(0, 500),
      color: input.color ?? '#10b981',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await database.goals.add(goal);
    await database.audit.add(auditRecord('goal.create', 'goal', goal.id, undefined, goalSnapshot(goal)));
    return goal;
  });
}

export async function updateGoal(
  database: FinanceDB,
  id: string,
  patch: Partial<GoalInput>,
): Promise<Goal> {
  return database.transaction('rw', database.goals, database.audit, async () => {
    const existing = await database.goals.get(id);
    if (!existing) throw new Error('Цель не найдена');
    const targetMinor = patch.targetMinor ?? existing.targetMinor;
    const savedMinor = patch.savedMinor ?? existing.savedMinor;
    assertMinor(targetMinor);
    assertMinor(savedMinor);
    if (targetMinor <= 0) throw new Error('Цель должна быть больше нуля');
    if (savedMinor < 0) throw new Error('Накоплено не может быть отрицательным');
    if (patch.deadline && !isValidDateKey(patch.deadline)) throw new Error('Некорректная дата');
    const next: Goal = {
      ...existing,
      name: (patch.name ?? existing.name).trim().slice(0, 100),
      targetMinor,
      savedMinor,
      deadline: patch.deadline === undefined ? existing.deadline : patch.deadline,
      note: patch.note === undefined ? existing.note : patch.note.trim().slice(0, 500),
      color: patch.color ?? existing.color,
      updatedAt: nowIso(),
    };
    if (!next.name) throw new Error('Введите название цели');
    await database.goals.put(next);
    await database.audit.add(
      auditRecord('goal.update', 'goal', id, goalSnapshot(existing), goalSnapshot(next)),
    );
    return next;
  });
}

export async function contributeToGoal(
  database: FinanceDB,
  id: string,
  deltaMinor: number,
): Promise<Goal> {
  assertMinor(deltaMinor);
  if (deltaMinor === 0) throw new Error('Сумма не может быть нулевой');
  return database.transaction('rw', database.goals, database.audit, async () => {
    const existing = await database.goals.get(id);
    if (!existing) throw new Error('Цель не найдена');
    const saved = existing.savedMinor + deltaMinor;
    if (saved < 0) throw new Error('Нельзя снять больше, чем отложено');
    const next: Goal = {
      ...existing,
      savedMinor: saved,
      updatedAt: nowIso(),
    };
    await database.goals.put(next);
    await database.audit.add(
      auditRecord(
        deltaMinor > 0 ? 'goal.contribute' : 'goal.withdraw',
        'goal',
        id,
        { savedMinor: existing.savedMinor },
        { savedMinor: saved },
      ),
    );
    return next;
  });
}

export async function deleteGoal(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.goals, database.audit, async () => {
    const existing = await database.goals.get(id);
    if (!existing) throw new Error('Цель не найдена');
    await database.goals.put({ ...existing, deletedAt: nowIso(), updatedAt: nowIso() });
    await database.audit.add(auditRecord('goal.delete', 'goal', id, goalSnapshot(existing), undefined));
  });
}

function goalSnapshot(goal: Goal) {
  return { name: goal.name, targetMinor: goal.targetMinor, savedMinor: goal.savedMinor };
}

/* ------------------------ Planned payments ------------------------ */

export type PlannedPaymentInput = {
  name: string;
  amountMinor: number;
  dayOfMonth: number;
  accountId?: string;
  categoryId?: string;
  note?: string;
  active?: boolean;
};

export async function createPlannedPayment(
  database: FinanceDB,
  input: PlannedPaymentInput,
): Promise<PlannedPayment> {
  validatePlannedPayment(input);
  return database.transaction('rw', database.plannedPayments, database.audit, async () => {
    const now = nowIso();
    const payment: PlannedPayment = {
      id: newId(),
      name: input.name.trim().slice(0, 100),
      amountMinor: input.amountMinor,
      dayOfMonth: input.dayOfMonth,
      accountId: input.accountId,
      categoryId: input.categoryId,
      note: input.note?.trim().slice(0, 500),
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await database.plannedPayments.add(payment);
    await database.audit.add(
      auditRecord('plannedPayment.create', 'plannedPayment', payment.id, undefined, plannedSnapshot(payment)),
    );
    return payment;
  });
}

export async function updatePlannedPayment(
  database: FinanceDB,
  id: string,
  patch: Partial<PlannedPaymentInput>,
): Promise<PlannedPayment> {
  return database.transaction('rw', database.plannedPayments, database.audit, async () => {
    const existing = await database.plannedPayments.get(id);
    if (!existing) throw new Error('Платёж не найден');
    const merged: PlannedPaymentInput = {
      name: patch.name ?? existing.name,
      amountMinor: patch.amountMinor ?? existing.amountMinor,
      dayOfMonth: patch.dayOfMonth ?? existing.dayOfMonth,
      accountId: patch.accountId ?? existing.accountId,
      categoryId: patch.categoryId ?? existing.categoryId,
      note: patch.note ?? existing.note,
      active: patch.active ?? existing.active,
    };
    validatePlannedPayment(merged);
    const next: PlannedPayment = {
      ...existing,
      ...merged,
      name: merged.name.trim().slice(0, 100),
      updatedAt: nowIso(),
    };
    await database.plannedPayments.put(next);
    await database.audit.add(
      auditRecord('plannedPayment.update', 'plannedPayment', id, plannedSnapshot(existing), plannedSnapshot(next)),
    );
    return next;
  });
}

export async function deletePlannedPayment(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.plannedPayments, database.audit, async () => {
    const existing = await database.plannedPayments.get(id);
    if (!existing) throw new Error('Платёж не найден');
    await database.plannedPayments.put({ ...existing, deletedAt: nowIso(), updatedAt: nowIso() });
    await database.audit.add(
      auditRecord('plannedPayment.delete', 'plannedPayment', id, plannedSnapshot(existing), undefined),
    );
  });
}

function validatePlannedPayment(input: PlannedPaymentInput) {
  if (!input.name.trim()) throw new Error('Введите название платежа');
  assertMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error('Сумма платежа должна быть больше нуля');
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    throw new Error('День платежа должен быть от 1 до 31');
  }
}

function plannedSnapshot(payment: PlannedPayment) {
  return {
    name: payment.name,
    amountMinor: payment.amountMinor,
    dayOfMonth: payment.dayOfMonth,
    active: payment.active,
  };
}

/* ------------------------- Planned inflows ------------------------ */

export type PlannedInflowInput = {
  name: string;
  amountMinor: number;
  expectedDate: string;
  confidence: InflowConfidence;
};

export async function createPlannedInflow(
  database: FinanceDB,
  input: PlannedInflowInput,
): Promise<PlannedInflow> {
  validateInflow(input);
  return database.transaction('rw', database.plannedInflows, database.audit, async () => {
    const now = nowIso();
    const inflow: PlannedInflow = {
      id: newId(),
      name: input.name.trim().slice(0, 100),
      amountMinor: input.amountMinor,
      expectedDate: input.expectedDate,
      confidence: input.confidence,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await database.plannedInflows.add(inflow);
    await database.audit.add(
      auditRecord('plannedInflow.create', 'plannedInflow', inflow.id, undefined, inflowSnapshot(inflow)),
    );
    return inflow;
  });
}

export async function updatePlannedInflow(
  database: FinanceDB,
  id: string,
  patch: Partial<PlannedInflowInput>,
): Promise<PlannedInflow> {
  return database.transaction('rw', database.plannedInflows, database.audit, async () => {
    const existing = await database.plannedInflows.get(id);
    if (!existing) throw new Error('Поступление не найдено');
    const merged: PlannedInflowInput = {
      name: patch.name ?? existing.name,
      amountMinor: patch.amountMinor ?? existing.amountMinor,
      expectedDate: patch.expectedDate ?? existing.expectedDate,
      confidence: patch.confidence ?? existing.confidence,
    };
    validateInflow(merged);
    const next: PlannedInflow = {
      ...existing,
      ...merged,
      name: merged.name.trim().slice(0, 100),
      updatedAt: nowIso(),
    };
    await database.plannedInflows.put(next);
    await database.audit.add(
      auditRecord('plannedInflow.update', 'plannedInflow', id, inflowSnapshot(existing), inflowSnapshot(next)),
    );
    return next;
  });
}

export async function deletePlannedInflow(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.plannedInflows, database.audit, async () => {
    const existing = await database.plannedInflows.get(id);
    if (!existing) throw new Error('Поступление не найдено');
    await database.plannedInflows.put({ ...existing, deletedAt: nowIso(), updatedAt: nowIso() });
    await database.audit.add(
      auditRecord('plannedInflow.delete', 'plannedInflow', id, inflowSnapshot(existing), undefined),
    );
  });
}

function validateInflow(input: PlannedInflowInput) {
  if (!input.name.trim()) throw new Error('Введите название поступления');
  assertMinor(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!isValidDateKey(input.expectedDate)) throw new Error('Некорректная дата поступления');
  if (!['confirmed', 'likely', 'possible'].includes(input.confidence)) {
    throw new Error('Неизвестная уверенность');
  }
}

function inflowSnapshot(inflow: PlannedInflow) {
  return {
    name: inflow.name,
    amountMinor: inflow.amountMinor,
    expectedDate: inflow.expectedDate,
    confidence: inflow.confidence,
  };
}

/* ----------------------------- Budgets ---------------------------- */

export async function setBudget(
  database: FinanceDB,
  month: string,
  amountMinor: number,
): Promise<Budget> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Некорректный месяц');
  assertMinor(amountMinor);
  if (amountMinor < 0) throw new Error('Бюджет не может быть отрицательным');
  return database.transaction('rw', database.budgets, database.settings, database.audit, async () => {
    const previous = await database.budgets.get(month);
    const budget: Budget = { month, amountMinor, updatedAt: nowIso() };
    await database.budgets.put(budget);
    if (month === monthKey()) {
      const settings = await database.settings.get('app');
      if (settings) {
        await database.settings.put({
          ...settings,
          monthlyBudgetMinor: amountMinor,
          updatedAt: nowIso(),
        });
      }
    }
    await database.audit.add(
      auditRecord('budget.update', 'budget', month, previous ? { amountMinor: previous.amountMinor } : undefined, {
        amountMinor,
      }),
    );
    return budget;
  });
}
