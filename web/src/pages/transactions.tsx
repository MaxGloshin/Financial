import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { formatMonth, monthKey, monthRange, relativeDayLabel, shiftMonth, toDateValue } from '@/lib/dates.ts';
import { formatMoney } from '@/lib/money.ts';
import { monthSummary } from '@/domain/finance.ts';
import type { TransactionKind } from '@/domain/types.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { SegmentedControl } from '@/components/ui/segmented.tsx';
import { TransactionRow } from '@/components/transaction-row.tsx';
import { cn } from '@/lib/utils.ts';

type Filter = 'all' | TransactionKind;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
  { value: 'transfer', label: 'Переводы' },
  { value: 'credit_payment', label: 'Кредитка' },
  { value: 'debt_payment', label: 'Долги' },
];

export function TransactionsPage() {
  const { snapshot, openQuickAdd } = useApp();
  const [month, setMonth] = useState(monthKey());
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const summary = useMemo(() => monthSummary(snapshot, month), [snapshot, month]);
  const categoryNames = useMemo(
    () => new Map(snapshot.categories.map((category) => [category.id, category.name])),
    [snapshot.categories],
  );
  const accountNames = useMemo(
    () => new Map(snapshot.accounts.map((account) => [account.id, account.name])),
    [snapshot.accounts],
  );

  const filtered = useMemo(() => {
    const range = monthRange(month);
    const term = query.trim().toLowerCase();
    return snapshot.transactions
      .filter(
        (transaction) =>
          !transaction.deletedAt &&
          transaction.occurredAt >= range.fromIso &&
          transaction.occurredAt < range.toIso &&
          (filter === 'all' || transaction.kind === filter),
      )
      .filter((transaction) => {
        if (!term) return true;
        const haystack = [
          transaction.description,
          categoryNames.get(transaction.categoryId ?? '') ?? '',
          accountNames.get(transaction.accountId ?? '') ?? '',
          accountNames.get(transaction.fromAccountId ?? '') ?? '',
          accountNames.get(transaction.toAccountId ?? '') ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }, [snapshot.transactions, month, filter, query, categoryNames, accountNames]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const transaction of filtered) {
      const key = toDateValue(transaction.occurredAt);
      map.set(key, [...(map.get(key) ?? []), transaction]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Операции</h1>
          <p className="text-sm text-muted-foreground">
            Реальные доходы и расходы. Переводы и кредитка не входят в статистику.
          </p>
        </div>
        <Button onClick={() => openQuickAdd('expense')}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Добавить</span>
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="icon" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <button
              type="button"
              className="text-sm font-semibold capitalize"
              onClick={() => setMonth(monthKey())}
            >
              {formatMonth(month)}
            </button>
            <Button variant="ghost" size="icon" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3">
            <div>
              <p className="text-xs text-muted-foreground">Доходы</p>
              <p className="text-base font-semibold tabular text-success">
                +{formatMoney(summary.incomeMinor)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Расходы</p>
              <p className="text-base font-semibold tabular">−{formatMoney(summary.expenseMinor)}</p>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по описанию, категории, счёту"
              className="pl-9"
              aria-label="Поиск операций"
            />
          </div>

          <SegmentedControl value={filter} onChange={setFilter} options={FILTERS} size="sm" />
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <SlidersHorizontal className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Операций не найдено</p>
            <p className="text-sm text-muted-foreground">
              Измените фильтр или добавьте новую операцию.
            </p>
            <Button className="mt-2" onClick={() => openQuickAdd('expense')}>
              <Plus className="h-4 w-4" /> Добавить операцию
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map(([date, transactions]) => {
            const dayExpense = transactions
              .filter((transaction) => transaction.kind === 'expense')
              .reduce((total, transaction) => total + transaction.amountMinor, 0);
            return (
              <Card key={date}>
                <CardContent className="p-4">
                  <div className="mb-1 flex items-baseline justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {relativeDayLabel(date)}
                    </h2>
                    {dayExpense > 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        −{formatMoney(dayExpense)}
                      </span>
                    ) : null}
                  </div>
                  <div className={cn('divide-y divide-border/60')}>
                    {transactions.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        onClick={() => openQuickAdd(transaction.kind, transaction)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
