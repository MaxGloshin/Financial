import type { Account, AppSettings, Debt, PlannedPayment } from '../domain/types.ts';
import {
  isValidDateKey,
  monthKey,
  nextOccurrenceOfDay,
  nowIso,
  todayKey,
} from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { assertMinor } from '../lib/money.ts';
import type { FinanceDB } from './db.ts';
import { auditRecord } from './audit.ts';
import { ensureBaseData } from './defaults.ts';

export type OnboardingPaymentInput = {
  name: string;
  amountMinor: number;
  dayOfMonth: number;
};

export type OnboardingInput = {
  cashMinor: number;
  debitMinor: number;
  creditDebtMinor: number;
  creditLimitMinor?: number;
  owedToMeMinor?: number;
  owedToMeCounterparty?: string;
  monthlyBudgetMinor: number;
  regularIncomeMinor?: number;
  regularIncomeDay?: number;
  regularIncomeDate?: string;
  payments?: OnboardingPaymentInput[];
};

export type OnboardingResult = {
  cashAccountId: string;
  debitAccountId: string;
  creditAccountId?: string;
  debtId?: string;
};

export async function completeOnboarding(
  database: FinanceDB,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  assertMinor(input.cashMinor);
  assertMinor(input.debitMinor);
  assertMinor(input.creditDebtMinor);
  assertMinor(input.monthlyBudgetMinor);
  if (input.cashMinor < 0 || input.debitMinor < 0 || input.creditDebtMinor < 0) {
    throw new Error('Суммы не могут быть отрицательными');
  }
  if (input.monthlyBudgetMinor < 0) throw new Error('Бюджет не может быть отрицательным');
  if (input.creditLimitMinor !== undefined) assertMinor(input.creditLimitMinor);
  if (input.owedToMeMinor !== undefined && input.owedToMeMinor < 0) {
    throw new Error('Сумма долга не может быть отрицательной');
  }

  await ensureBaseData(database);

  return database.transaction(
    'rw',
    [
      database.accounts,
      database.debts,
      database.settings,
      database.budgets,
      database.plannedInflows,
      database.plannedPayments,
      database.audit,
    ],
    async () => {
      const accountCount = await database.accounts.count();
      if (accountCount > 0) throw new Error('Настройка уже выполнена. Измените счета вручную.');

      const now = nowIso();
      const cash: Account = {
        id: newId(),
        name: 'Наличные',
        type: 'cash',
        openingBalanceMinor: input.cashMinor,
        openingBalanceAt: now,
        currency: 'RUB',
        sortOrder: 0,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      const debit: Account = {
        id: newId(),
        name: 'Дебетовая карта',
        type: 'debit',
        openingBalanceMinor: input.debitMinor,
        openingBalanceAt: now,
        currency: 'RUB',
        sortOrder: 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      await database.accounts.bulkAdd([cash, debit]);

      let credit: Account | undefined;
      if (input.creditDebtMinor > 0 || (input.creditLimitMinor ?? 0) > 0) {
        credit = {
          id: newId(),
          name: 'Кредитная карта',
          type: 'credit',
          openingBalanceMinor: -input.creditDebtMinor,
          openingBalanceAt: now,
          creditLimitMinor: input.creditLimitMinor ?? 0,
          currency: 'RUB',
          sortOrder: 2,
          archived: false,
          createdAt: now,
          updatedAt: now,
        };
        await database.accounts.add(credit);
      }

      let debt: Debt | undefined;
      if ((input.owedToMeMinor ?? 0) > 0) {
        debt = {
          id: newId(),
          direction: 'owed_to_me',
          counterparty: (input.owedToMeCounterparty ?? 'Мне должны').trim().slice(0, 120),
          amountMinor: input.owedToMeMinor!,
          paidMinor: 0,
          dueDate: null,
          status: 'open',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await database.debts.add(debt);
      }

      const currentBudget = await database.settings.get('app');
      const settings: AppSettings = {
        id: 'app',
        onboardingComplete: true,
        currency: 'RUB',
        monthlyBudgetMinor: input.monthlyBudgetMinor,
        defaultAccountId: debit.id,
        theme: currentBudget?.theme ?? 'system',
        createdAt: currentBudget?.createdAt ?? now,
        updatedAt: now,
      };
      await database.settings.put(settings);
      await database.budgets.put({
        month: monthKey(),
        amountMinor: input.monthlyBudgetMinor,
        updatedAt: now,
      });

      if ((input.regularIncomeMinor ?? 0) > 0) {
        const expectedDate =
          input.regularIncomeDate && isValidDateKey(input.regularIncomeDate)
            ? input.regularIncomeDate
            : input.regularIncomeDay
              ? nextOccurrenceOfDay(input.regularIncomeDay, todayKey())
              : nextOccurrenceOfDay(10, todayKey());
        await database.plannedInflows.add({
          id: newId(),
          name: 'Регулярный доход',
          amountMinor: input.regularIncomeMinor!,
          expectedDate,
          confidence: 'likely',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      const payments: PlannedPayment[] = [];
      for (const [index, payment] of (input.payments ?? []).entries()) {
        if (!payment.name.trim() || payment.amountMinor <= 0) continue;
        if (!Number.isInteger(payment.dayOfMonth) || payment.dayOfMonth < 1 || payment.dayOfMonth > 31) {
          continue;
        }
        payments.push({
          id: newId(),
          name: payment.name.trim().slice(0, 100),
          amountMinor: payment.amountMinor,
          dayOfMonth: payment.dayOfMonth,
          accountId: debit.id,
          active: true,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          note: undefined,
          categoryId: undefined,
        });
        if (index > 49) break;
      }
      if (payments.length > 0) await database.plannedPayments.bulkAdd(payments);

      await database.audit.add(
        auditRecord('onboarding.complete', 'settings', 'app', undefined, {
          cashMinor: input.cashMinor,
          debitMinor: input.debitMinor,
          creditDebtMinor: input.creditDebtMinor,
          monthlyBudgetMinor: input.monthlyBudgetMinor,
          payments: payments.length,
        }),
      );

      return {
        cashAccountId: cash.id,
        debitAccountId: debit.id,
        creditAccountId: credit?.id,
        debtId: debt?.id,
      };
    },
  );
}
