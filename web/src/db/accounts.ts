import type { Account, AccountType } from '../domain/types.ts';
import { nowIso } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { assertMinor } from '../lib/money.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';

export type AccountInput = {
  name: string;
  type: AccountType;
  openingBalanceMinor: number;
  creditLimitMinor?: number;
  statementDay?: number;
  paymentDueDay?: number;
  color?: string;
};

function validate(input: AccountInput): void {
  if (!input.name.trim()) throw new Error('Введите название счёта');
  if (!['cash', 'debit', 'savings', 'credit'].includes(input.type)) {
    throw new Error('Неизвестный тип счёта');
  }
  assertMinor(input.openingBalanceMinor);
  if (input.creditLimitMinor !== undefined) {
    assertMinor(input.creditLimitMinor);
    if (input.creditLimitMinor < 0) throw new Error('Кредитный лимит не может быть отрицательным');
  }
  for (const day of [input.statementDay, input.paymentDueDay]) {
    if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > 31)) {
      throw new Error('День месяца должен быть от 1 до 31');
    }
  }
}

export async function createAccount(
  database: FinanceDB,
  input: AccountInput,
): Promise<Account> {
  validate(input);
  return database.transaction('rw', database.accounts, database.audit, async () => {
    const count = await database.accounts.count();
    const now = nowIso();
    const account: Account = {
      id: newId(),
      name: input.name.trim().slice(0, 80),
      type: input.type,
      openingBalanceMinor: input.openingBalanceMinor,
      openingBalanceAt: now,
      currency: 'RUB',
      creditLimitMinor: input.type === 'credit' ? input.creditLimitMinor ?? 0 : undefined,
      statementDay: input.type === 'credit' ? input.statementDay : undefined,
      paymentDueDay:
        input.type === 'credit' ? input.paymentDueDay : input.paymentDueDay,
      color: input.color,
      sortOrder: count,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await database.accounts.add(account);
    await database.audit.add(auditRecord('account.create', 'account', account.id, undefined, snapshot(account)));
    return account;
  });
}

export async function updateAccount(
  database: FinanceDB,
  id: string,
  patch: Partial<AccountInput> & { archived?: boolean; sortOrder?: number },
): Promise<Account> {
  return database.transaction('rw', database.accounts, database.audit, async () => {
    const existing = await database.accounts.get(id);
    if (!existing) throw new Error('Счёт не найден');
    const merged: AccountInput = {
      name: patch.name ?? existing.name,
      type: patch.type ?? existing.type,
      openingBalanceMinor: patch.openingBalanceMinor ?? existing.openingBalanceMinor,
      creditLimitMinor: patch.creditLimitMinor ?? existing.creditLimitMinor,
      statementDay: patch.statementDay ?? existing.statementDay,
      paymentDueDay: patch.paymentDueDay ?? existing.paymentDueDay,
      color: patch.color ?? existing.color,
    };
    validate(merged);
    const next: Account = {
      ...existing,
      ...merged,
      name: merged.name.trim().slice(0, 80),
      creditLimitMinor: merged.type === 'credit' ? merged.creditLimitMinor ?? 0 : undefined,
      statementDay: merged.type === 'credit' ? merged.statementDay : undefined,
      paymentDueDay: merged.paymentDueDay,
      archived: patch.archived ?? existing.archived,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      updatedAt: nowIso(),
    };
    await database.accounts.put(next);
    await database.audit.add(
      auditRecord('account.update', 'account', id, snapshot(existing), snapshot(next)),
    );
    return next;
  });
}

export async function deleteAccount(database: FinanceDB, id: string): Promise<void> {
  await database.transaction('rw', database.accounts, database.entries, database.audit, async () => {
    const existing = await database.accounts.get(id);
    if (!existing) throw new Error('Счёт не найден');
    const used = await database.entries.where('accountId').equals(id).count();
    if (used > 0) {
      throw new Error('По счёту есть операции. Архивируйте его вместо удаления.');
    }
    await database.accounts.delete(id);
    await database.audit.add(
      auditRecord('account.delete', 'account', id, snapshot(existing), undefined),
    );
  });
}

function snapshot(account: Account) {
  return {
    name: account.name,
    type: account.type,
    openingBalanceMinor: account.openingBalanceMinor,
    creditLimitMinor: account.creditLimitMinor,
    archived: account.archived,
  };
}
