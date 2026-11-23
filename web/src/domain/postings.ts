import type {
  Account,
  Category,
  Debt,
  TransactionDraft,
  TransactionKind,
} from './types.ts';

export type Posting = {
  accountId: string | null;
  categoryId: string | null;
  amountMinor: number;
};

export type PostingContext = {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  debts: Map<string, Debt>;
};

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  credit_payment: 'Погашение кредитки',
  debt_payment: 'Возврат долга',
  refund: 'Возврат',
  adjustment: 'Корректировка',
};

export function transactionKindLabel(kind: TransactionKind): string {
  return TRANSACTION_KIND_LABELS[kind];
}

function getAccount(context: PostingContext, id: string | undefined, role: string): Account {
  if (!id) throw new Error(`Не выбран счёт (${role})`);
  const account = context.accounts.get(id);
  if (!account) throw new Error('Счёт не найден');
  if (account.archived) throw new Error('Счёт архивирован');
  return account;
}

function getCategory(
  context: PostingContext,
  id: string | undefined,
  kind: 'expense' | 'income',
): Category {
  if (!id) throw new Error('Не выбрана категория');
  const category = context.categories.get(id);
  if (!category) throw new Error('Категория не найдена');
  if (category.kind !== kind) throw new Error(`Категория «${category.name}» не подходит`);
  return category;
}

function requirePositive(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Сумма должна быть в копейках');
  if (amountMinor <= 0) throw new Error('Сумма должна быть больше нуля');
}

/**
 * Turns a transaction draft into balanced ledger postings.
 * Transfers and debt/credit payments only touch accounts, so they can never
 * leak into income/expense statistics.
 */
export function buildPostings(draft: TransactionDraft, context: PostingContext): Posting[] {
  const amount = draft.amountMinor;

  switch (draft.kind) {
    case 'expense': {
      requirePositive(amount);
      const account = getAccount(context, draft.accountId, 'списание');
      const category = getCategory(context, draft.categoryId, 'expense');
      return [
        { accountId: account.id, categoryId: null, amountMinor: -amount },
        { accountId: null, categoryId: category.id, amountMinor: amount },
      ];
    }
    case 'income': {
      requirePositive(amount);
      const account = getAccount(context, draft.accountId, 'зачисление');
      if (account.type === 'credit') throw new Error('Доход нельзя зачислить на кредитку');
      const category = getCategory(context, draft.categoryId, 'income');
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: category.id, amountMinor: -amount },
      ];
    }
    case 'refund': {
      requirePositive(amount);
      const account = getAccount(context, draft.accountId, 'возврат');
      const category = getCategory(context, draft.categoryId, 'expense');
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: category.id, amountMinor: -amount },
      ];
    }
    case 'transfer': {
      requirePositive(amount);
      const from = getAccount(context, draft.fromAccountId, 'списание');
      const to = getAccount(context, draft.toAccountId, 'зачисление');
      if (from.id === to.id) throw new Error('Нельзя перевести на тот же счёт');
      if (from.type === 'credit' || to.type === 'credit') {
        throw new Error('Для кредитки используйте «Погашение кредитки»');
      }
      return [
        { accountId: from.id, categoryId: null, amountMinor: -amount },
        { accountId: to.id, categoryId: null, amountMinor: amount },
      ];
    }
    case 'credit_payment': {
      requirePositive(amount);
      const from = getAccount(context, draft.fromAccountId, 'списание');
      const credit = getAccount(context, draft.toAccountId, 'кредитка');
      if (from.id === credit.id) throw new Error('Нельзя погасить кредитку с неё же');
      if (credit.type !== 'credit') throw new Error('Целевой счёт должен быть кредитным');
      if (from.type === 'credit') throw new Error('Погашать кредитку можно только со своего счёта');
      return [
        { accountId: from.id, categoryId: null, amountMinor: -amount },
        { accountId: credit.id, categoryId: null, amountMinor: amount },
      ];
    }
    case 'debt_payment': {
      requirePositive(amount);
      if (!draft.debtId) throw new Error('Не выбран долг');
      const debt = context.debts.get(draft.debtId);
      if (!debt || debt.deletedAt) throw new Error('Долг не найден');
      if (debt.status === 'paid') throw new Error('Долг уже закрыт');
      const remaining = debt.amountMinor - debt.paidMinor;
      if (amount > remaining) throw new Error('Сумма больше остатка долга');
      const account = getAccount(context, draft.accountId, 'счёт');
      if (account.type === 'credit') throw new Error('Выберите наличный или дебетовый счёт');
      const sign = debt.direction === 'owed_to_me' ? 1 : -1;
      return [{ accountId: account.id, categoryId: null, amountMinor: sign * amount }];
    }
    case 'adjustment': {
      if (!Number.isSafeInteger(amount) || amount === 0) {
        throw new Error('Сумма корректировки не может быть нулевой');
      }
      const account = getAccount(context, draft.accountId, 'корректировка');
      if (!draft.categoryId) {
        return [{ accountId: account.id, categoryId: null, amountMinor: amount }];
      }
      const category = getCategory(context, draft.categoryId, 'expense');
      return [
        { accountId: account.id, categoryId: null, amountMinor: amount },
        { accountId: null, categoryId: category.id, amountMinor: -amount },
      ];
    }
    default: {
      const exhaustive: never = draft.kind;
      throw new Error(`Неизвестный тип операции: ${String(exhaustive)}`);
    }
  }
}

export function assertBalanced(postings: Posting[]): void {
  const total = postings.reduce((sum, posting) => sum + posting.amountMinor, 0);
  if (total !== 0) throw new Error('Внутренняя ошибка: проводки не сбалансированы');
}
