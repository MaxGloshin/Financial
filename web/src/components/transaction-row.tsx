import { ArrowLeftRight, CreditCard, HandCoins, RotateCcw } from 'lucide-react';
import type { Transaction } from '@/domain/types.ts';
import { transactionKindLabel } from '@/domain/postings.ts';
import { formatMoney } from '@/lib/money.ts';
import { formatTime } from '@/lib/dates.ts';
import { useApp } from '@/state/app-context.tsx';
import { CategoryIcon } from './category-icon.tsx';
import { cn } from '@/lib/utils.ts';

export function TransactionRow({
  transaction,
  onClick,
  showTime = true,
}: {
  transaction: Transaction;
  onClick?: () => void;
  showTime?: boolean;
}) {
  const { snapshot } = useApp();
  const category = snapshot.categories.find((item) => item.id === transaction.categoryId);
  const account = snapshot.accounts.find((item) => item.id === transaction.accountId);
  const from = snapshot.accounts.find((item) => item.id === transaction.fromAccountId);
  const to = snapshot.accounts.find((item) => item.id === transaction.toAccountId);

  const iconName =
    category?.icon ??
    (transaction.kind === 'transfer'
      ? 'arrow-left-right'
      : transaction.kind === 'credit_payment'
        ? 'credit-card'
        : transaction.kind === 'debt_payment'
          ? 'hand-coins'
          : transaction.kind === 'income'
            ? 'wallet'
            : 'receipt');

  const title = transaction.description || transactionKindLabel(transaction.kind);
  const subtitle =
    transaction.kind === 'transfer' || transaction.kind === 'credit_payment'
      ? `${from?.name ?? '—'} → ${to?.name ?? '—'}`
      : transaction.kind === 'debt_payment'
        ? category?.name ?? transactionKindLabel(transaction.kind)
        : [category?.name, account?.name].filter(Boolean).join(' · ') || account?.name || '';

  const negative = transaction.kind === 'expense';
  const positive = transaction.kind === 'income' || transaction.kind === 'refund';
  const neutral =
    transaction.kind === 'transfer' ||
    transaction.kind === 'credit_payment' ||
    transaction.kind === 'debt_payment' ||
    transaction.kind === 'adjustment';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors',
        onClick && 'hover:bg-muted/60',
      )}
    >
      <CategoryIcon name={iconName} color={category?.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {subtitle}
          {showTime ? ` · ${formatTime(transaction.occurredAt)}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {neutral ? (
          <span className="text-sm tabular text-muted-foreground">
            {formatMoney(transaction.amountMinor, { noCurrency: true })}
          </span>
        ) : (
          <span
            className={cn(
              'text-sm font-semibold tabular',
              negative && 'text-foreground',
              positive && 'text-success',
            )}
          >
            {negative ? '−' : '+'}
            {formatMoney(transaction.amountMinor, { noCurrency: true })}
          </span>
        )}
        {transaction.kind === 'refund' ? (
          <p className="flex items-center justify-end gap-1 text-[10px] text-success">
            <RotateCcw className="h-3 w-3" /> возврат
          </p>
        ) : transaction.kind === 'transfer' ? (
          <p className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            <ArrowLeftRight className="h-3 w-3" /> перевод
          </p>
        ) : transaction.kind === 'credit_payment' ? (
          <p className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            <CreditCard className="h-3 w-3" /> не расход
          </p>
        ) : transaction.kind === 'debt_payment' ? (
          <p className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            <HandCoins className="h-3 w-3" /> долг
          </p>
        ) : null}
      </div>
    </button>
  );
}
