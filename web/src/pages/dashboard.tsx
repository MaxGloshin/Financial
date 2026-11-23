import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  Coins,
  CreditCard,
  Landmark,
  PiggyBank,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import {
  forecast,
  moneyOverview,
  monthSummary,
  nearestPayment,
  purchaseAssessment,
} from '@/domain/finance.ts';
import { backupStatus } from '@/db/backup.ts';
import { formatDate, formatMonth, monthKey, todayKey } from '@/lib/dates.ts';
import { formatMoney, parseMoneyToMinor } from '@/lib/money.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Money } from '@/components/money.tsx';
import { TransactionRow } from '@/components/transaction-row.tsx';
import { cn } from '@/lib/utils.ts';
import type { InflowConfidence } from '@/domain/types.ts';

const CONFIDENCE_LABEL: Record<InflowConfidence, string> = {
  confirmed: 'подтверждено',
  likely: 'вероятно',
  possible: 'возможно',
};

export function DashboardPage() {
  const { snapshot, settings, openQuickAdd } = useApp();
  const navigate = useNavigate();
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const now = new Date();
  const month = monthKey(now);
  const overview = useMemo(() => moneyOverview(snapshot), [snapshot]);
  const summary = useMemo(() => monthSummary(snapshot, month, now), [snapshot, month]);
  const projection = useMemo(() => forecast(snapshot, month, now), [snapshot, month]);
  const payment = useMemo(() => nearestPayment(snapshot), [snapshot]);
  const recent = useMemo(
    () =>
      snapshot.transactions
        .filter((transaction) => !transaction.deletedAt)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, 6),
    [snapshot.transactions],
  );
  const backup = backupStatus(settings, now);
  const goals = snapshot.goals.filter((goal) => !goal.deletedAt);
  const goalSaved = goals.reduce((total, goal) => total + goal.savedMinor, 0);
  const goalTarget = goals.reduce((total, goal) => total + goal.targetMinor, 0);

  const purchaseCheck = useMemo(() => {
    if (!purchaseAmount.trim()) return null;
    try {
      const minor = parseMoneyToMinor(purchaseAmount);
      if (minor <= 0) throw new Error('Сумма должна быть больше нуля');
      return { minor, result: purchaseAssessment(minor, snapshot, now), error: null };
    } catch (error) {
      return {
        minor: 0,
        result: null,
        error: error instanceof Error ? error.message : 'Проверьте сумму',
      };
    }
  }, [purchaseAmount, snapshot]);

  const budgetOver = summary.availableBudgetMinor < 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {formatDate(todayKey(), true)}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Обзор</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => openQuickAdd('expense')} className="md:hidden">
          <Sparkles className="h-4 w-4" /> Быстро
        </Button>
      </div>

      {backup.needsWarning ? (
        <Link
          to="/settings"
          className="flex items-start gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-3.5 text-sm"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{backup.label}</span>
            <span className="block text-xs text-muted-foreground">
              Если очистить данные сайта или удалить приложение, восстановить их будет нечем.
              Скачайте JSON-копию в настройках.
            </span>
          </span>
          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}

      <section className="relative overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20 md:p-6">
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 right-10 h-36 w-36 rounded-full bg-white/5" />
        <div className="relative">
          <div className="flex items-center gap-2 text-primary-foreground/80">
            <Wallet className="h-4 w-4" />
            <span className="text-sm">Собственные деньги</span>
          </div>
          <p className="mt-1 text-[2.6rem] font-semibold leading-none tracking-tight tabular md:text-5xl">
            {formatMoney(overview.ownFundsMinor)}
          </p>
          <p className="mt-2 text-xs text-primary-foreground/70">
            Наличные и счета минус задолженность по кредитке. Кредитный лимит не учитывается.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/10 p-2.5">
              <p className="text-[11px] text-primary-foreground/70">Наличные</p>
              <p className="mt-0.5 text-sm font-semibold tabular">{formatMoney(overview.cashMinor)}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-2.5">
              <p className="text-[11px] text-primary-foreground/70">Дебетовые</p>
              <p className="mt-0.5 text-sm font-semibold tabular">
                {formatMoney(overview.debitMinor + overview.savingsMinor)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-2.5">
              <p className="text-[11px] text-primary-foreground/70">Долг кредитки</p>
              <p
                className={cn(
                  'mt-0.5 text-sm font-semibold tabular',
                  overview.creditDebtMinor > 0 && 'text-rose-100',
                )}
              >
                {formatMoney(overview.creditDebtMinor)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="sm:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{formatMonth(month)}</p>
              <Link to="/transactions" className="text-xs font-medium text-primary">
                Все операции
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5 text-success" /> Доходы
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular text-success">
                  +{formatMoney(summary.incomeMinor)}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5 text-destructive" /> Расходы
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular">
                  −{formatMoney(summary.expenseMinor)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Доступный бюджет</p>
            <p
              className={cn(
                'mt-1 text-xl font-semibold tabular',
                budgetOver && 'text-destructive',
              )}
            >
              {formatMoney(summary.availableBudgetMinor)}
            </p>
            <Progress
              value={summary.budgetUsedPercent}
              className="mt-3"
              indicatorClassName={budgetOver ? 'bg-destructive' : undefined}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Потрачено {formatMoney(summary.expenseMinor)} из {formatMoney(summary.budgetMinor)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Средний расход в день</p>
            <p className="mt-1 text-xl font-semibold tabular">
              {formatMoney(summary.averageDailyExpenseMinor)}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Прогноз к концу месяца: {formatMoney(summary.forecastMonthEndExpenseMinor)}
            </p>
            {projection.runwayDays !== null ? (
              <p className="text-[11px] text-muted-foreground">
                Денег хватит примерно на {projection.runwayDays} дн. при таком темпе
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {projection.warning ? (
        <div className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{projection.warning}</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Ближайший платёж</p>
              <Link to="/budget" className="text-xs text-primary">
                Планы
              </Link>
            </div>
            {payment ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">{payment.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{formatDate(payment.dueDate, true)}</span>
                  <Badge variant={payment.daysUntil <= 5 ? 'warning' : 'outline'}>
                    {payment.daysUntil === 0
                      ? 'сегодня'
                      : payment.daysUntil === 1
                        ? 'завтра'
                        : `через ${payment.daysUntil} дн.`}
                  </Badge>
                </div>
                <p className="mt-2 text-base font-semibold tabular">
                  {payment.amountMinor !== null
                    ? formatMoney(payment.amountMinor)
                    : 'Сумма неизвестна'}
                </p>
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                Нет запланированных платежей.
                <Link to="/budget" className="ml-1 text-primary">
                  Добавить
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Ближайшее поступление</p>
              <Link to="/budget" className="text-xs text-primary">
                Прогноз
              </Link>
            </div>
            {projection.nextInflow ? (
              <div className="mt-2">
                <p className="text-lg font-semibold">{projection.nextInflow.inflow.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{formatDate(projection.nextInflow.inflow.expectedDate, true)}</span>
                  <Badge
                    variant={
                      projection.nextInflow.inflow.confidence === 'confirmed'
                        ? 'success'
                        : projection.nextInflow.inflow.confidence === 'likely'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {CONFIDENCE_LABEL[projection.nextInflow.inflow.confidence]}
                  </Badge>
                </div>
                <p className="mt-2 text-base font-semibold tabular text-success">
                  +{formatMoney(projection.nextInflow.inflow.amountMinor)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Не добавлено в баланс: учитываются только реальные операции.
                </p>
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                Нет запланированных поступлений.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link to="/accounts" className="block">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Landmark className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Счета</p>
                <p className="truncate text-xs text-muted-foreground">
                  {snapshot.accounts.filter((account) => !account.archived).length} активных
                </p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link to="/debts" className="block">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Coins className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Долги</p>
                <p className="truncate text-xs text-muted-foreground">
                  Мне должны {formatMoney(overview.receivablesMinor)}
                </p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link to="/goals" className="block">
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Target className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Цели</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatMoney(goalSaved)} из {formatMoney(goalTarget)}
                </p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Последние операции</p>
              <Link to="/transactions" className="text-xs text-primary">
                Все
              </Link>
            </div>
            {recent.length === 0 ? (
              <div className="py-6 text-center">
                <PiggyBank className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Пока нет операций. Добавьте первый расход или доход.
                </p>
                <Button className="mt-3" size="sm" onClick={() => openQuickAdd('expense')}>
                  Добавить операцию
                </Button>
              </div>
            ) : (
              <div className="mt-1 divide-y divide-border/60">
                {recent.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    onClick={() => navigate('/transactions')}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium">Можно ли купить?</p>
            <p className="text-xs text-muted-foreground">
              Оценка по собственным деньгам и обязательным платежам. Ожидаемые доходы не
              учитываются.
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                value={purchaseAmount}
                onChange={(event) => {
                  setPurchaseAmount(event.target.value);
                  setPurchaseError(null);
                }}
                inputMode="decimal"
                placeholder="Сумма, например 5000"
                aria-label="Сумма покупки"
              />
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    parseMoneyToMinor(purchaseAmount);
                    setPurchaseError(null);
                  } catch (error) {
                    setPurchaseError(error instanceof Error ? error.message : 'Проверьте сумму');
                  }
                }}
              >
                Проверить
              </Button>
            </div>
            {purchaseError ? <p className="mt-2 text-xs text-destructive">{purchaseError}</p> : null}
            {purchaseCheck?.result ? (
              <div
                className={cn(
                  'mt-3 rounded-xl p-3 text-sm',
                  purchaseCheck.result.level === 'good' && 'bg-success/10',
                  purchaseCheck.result.level === 'warning' && 'bg-warning/15',
                  purchaseCheck.result.level === 'danger' && 'bg-destructive/10',
                )}
              >
                <p className="font-medium">
                  {purchaseCheck.result.level === 'good'
                    ? 'Покупка по средствам'
                    : purchaseCheck.result.level === 'warning'
                      ? 'Можно, но с осторожностью'
                      : 'Пока не стоит'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {purchaseCheck.result.reason}
                </p>
                <p className="mt-1.5 text-xs">
                  После покупки: <Money minor={purchaseCheck.result.afterPurchaseMinor} /> · с
                  обязательствами:{' '}
                  <Money minor={purchaseCheck.result.afterObligationsMinor} />
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Кредитка</p>
            <p className="text-xs text-muted-foreground">
              Долг {formatMoney(overview.creditDebtMinor)}
              {overview.creditLimitMinor > 0
                ? ` · лимит ${formatMoney(overview.creditLimitMinor)} · доступно ${formatMoney(
                    overview.creditAvailableMinor,
                  )}`
                : ''}
            </p>
          </div>
          <Link to="/accounts" className="text-xs font-medium text-primary">
            Подробнее
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
