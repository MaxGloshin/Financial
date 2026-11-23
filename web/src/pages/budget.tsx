import { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { budgetForMonth, forecast, monthSummary } from '@/domain/finance.ts';
import type { InflowConfidence, PlannedInflow, PlannedPayment } from '@/domain/types.ts';
import {
  createPlannedInflow,
  createPlannedPayment,
  deletePlannedInflow,
  deletePlannedPayment,
  setBudget,
  updatePlannedInflow,
  updatePlannedPayment,
} from '@/db/planning.ts';
import { db } from '@/db/db.ts';
import {
  formatDate,
  formatMonth,
  monthKey,
  nextOccurrenceOfDay,
  shiftMonth,
  todayKey,
} from '@/lib/dates.ts';
import { formatMoney, formatMoneyInput, parseMoneyToMinor } from '@/lib/money.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input, Select, Textarea } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';

const CONFIDENCE_LABEL: Record<InflowConfidence, string> = {
  confirmed: 'подтверждено',
  likely: 'вероятно',
  possible: 'возможно',
};

export function BudgetPage() {
  const { snapshot, settings } = useApp();
  const { toast } = useToast();
  const [month, setMonth] = useState(monthKey());
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetEditing, setBudgetEditing] = useState(false);

  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentEditing, setPaymentEditing] = useState<PlannedPayment | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    name: '',
    amount: '',
    dayOfMonth: '5',
    accountId: '',
    note: '',
  });

  const [inflowDialog, setInflowDialog] = useState(false);
  const [inflowEditing, setInflowEditing] = useState<PlannedInflow | null>(null);
  const [inflowForm, setInflowForm] = useState({
    name: '',
    amount: '',
    expectedDate: todayKey(),
    confidence: 'likely' as InflowConfidence,
  });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);

  const now = new Date();
  const summary = useMemo(() => monthSummary(snapshot, month, now), [snapshot, month]);
  const projection = useMemo(() => forecast(snapshot, month, now), [snapshot, month]);
  const budget = budgetForMonth(snapshot, month);
  const accounts = snapshot.accounts.filter((account) => !account.archived);
  const payments = snapshot.plannedPayments
    .filter((payment) => !payment.deletedAt)
    .sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const inflows = snapshot.plannedInflows
    .filter((inflow) => !inflow.deletedAt)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  async function saveBudget() {
    if (budgetSaving) return;
    setBudgetSaving(true);
    try {
      const amount = parseMoneyToMinor(budgetInput);
      await setBudget(db, month, amount);
      toast({ title: 'Бюджет сохранён', description: formatMonth(month), variant: 'success' });
      setBudgetEditing(false);
    } catch (error) {
      toast({
        title: 'Не удалось сохранить бюджет',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBudgetSaving(false);
    }
  }

  function startPayment(payment?: PlannedPayment) {
    setPaymentEditing(payment ?? null);
    setPaymentForm({
      name: payment?.name ?? '',
      amount: payment ? formatMoneyInput(payment.amountMinor) : '',
      dayOfMonth: String(payment?.dayOfMonth ?? 5),
      accountId: payment?.accountId ?? accounts.find((a) => a.type === 'debit')?.id ?? '',
      note: payment?.note ?? '',
    });
    setDialogError(null);
    setPaymentDialog(true);
  }

  async function savePayment() {
    if (dialogSaving) return;
    setDialogSaving(true);
    setDialogError(null);
    try {
      const input = {
        name: paymentForm.name,
        amountMinor: parseMoneyToMinor(paymentForm.amount),
        dayOfMonth: Number(paymentForm.dayOfMonth),
        accountId: paymentForm.accountId || undefined,
        note: paymentForm.note,
        active: true,
      };
      if (paymentEditing) {
        await updatePlannedPayment(db, paymentEditing.id, input);
        toast({ title: 'Платёж обновлён', variant: 'success' });
      } else {
        await createPlannedPayment(db, input);
        toast({ title: 'Платёж добавлен', variant: 'success' });
      }
      setPaymentDialog(false);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Не удалось сохранить платёж');
    } finally {
      setDialogSaving(false);
    }
  }

  async function removePayment(payment: PlannedPayment) {
    try {
      await deletePlannedPayment(db, payment.id);
      setPaymentDialog(false);
      toast({ title: 'Платёж удалён', variant: 'success' });
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Не удалось удалить');
    }
  }

  function startInflow(inflow?: PlannedInflow) {
    setInflowEditing(inflow ?? null);
    setInflowForm({
      name: inflow?.name ?? '',
      amount: inflow ? formatMoneyInput(inflow.amountMinor) : '',
      expectedDate: inflow?.expectedDate ?? nextOccurrenceOfDay(10),
      confidence: inflow?.confidence ?? 'likely',
    });
    setDialogError(null);
    setInflowDialog(true);
  }

  async function saveInflow() {
    if (dialogSaving) return;
    setDialogSaving(true);
    setDialogError(null);
    try {
      const input = {
        name: inflowForm.name,
        amountMinor: parseMoneyToMinor(inflowForm.amount),
        expectedDate: inflowForm.expectedDate,
        confidence: inflowForm.confidence,
      };
      if (inflowEditing) {
        await updatePlannedInflow(db, inflowEditing.id, input);
        toast({ title: 'Поступление обновлено', variant: 'success' });
      } else {
        await createPlannedInflow(db, input);
        toast({ title: 'Поступление добавлено', variant: 'success' });
      }
      setInflowDialog(false);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Не удалось сохранить поступление');
    } finally {
      setDialogSaving(false);
    }
  }

  async function removeInflow(inflow: PlannedInflow) {
    try {
      await deletePlannedInflow(db, inflow.id);
      setInflowDialog(false);
      toast({ title: 'Поступление удалено', variant: 'success' });
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Не удалось удалить');
    }
  }

  const budgetOver = summary.availableBudgetMinor < 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Бюджет и планы</h1>
        <p className="text-sm text-muted-foreground">
          Бюджет считается по реальным расходам. Плановые доходы не попадают в баланс.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
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

          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Доступно из бюджета</p>
              <p className={cn('text-3xl font-semibold tabular', budgetOver && 'text-destructive')}>
                {formatMoney(summary.availableBudgetMinor)}
              </p>
              <p className="text-xs text-muted-foreground">
                Потрачено {formatMoney(summary.expenseMinor)} из {formatMoney(budget)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              setBudgetInput(budget ? formatMoneyInput(budget) : '');
              setBudgetEditing(true);
            }}>
              <Pencil className="h-4 w-4" /> Бюджет
            </Button>
          </div>
          <Progress
            value={summary.budgetUsedPercent}
            indicatorClassName={budgetOver ? 'bg-destructive' : budget > 0 && summary.budgetUsedPercent > 85 ? 'bg-warning' : undefined}
          />
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[11px] text-muted-foreground">Средний день</p>
              <p className="font-semibold tabular">{formatMoney(summary.averageDailyExpenseMinor)}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[11px] text-muted-foreground">Прогноз месяца</p>
              <p className="font-semibold tabular">{formatMoney(summary.forecastMonthEndExpenseMinor)}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[11px] text-muted-foreground">До поступления</p>
              <p className="font-semibold tabular">
                {projection.daysUntilNextInflow !== null
                  ? `${projection.daysUntilNextInflow} дн.`
                  : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[11px] text-muted-foreground">Прогноз баланса</p>
              <p
                className={cn(
                  'font-semibold tabular',
                  projection.projectedBalanceUntilInflowMinor < 0 && 'text-destructive',
                )}
              >
                {formatMoney(projection.projectedBalanceUntilInflowMinor)}
              </p>
            </div>
          </div>
          {projection.warning ? (
            <p className="rounded-xl bg-warning/15 px-3 py-2 text-xs text-muted-foreground">
              {projection.warning}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Wallet className="h-4 w-4 text-primary" /> Плановые доходы
                </h2>
                <p className="text-xs text-muted-foreground">Не учитываются как уже полученные</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => startInflow()}>
                <Plus className="h-4 w-4" /> Добавить
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {inflows.length === 0 ? (
                <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  Нет плановых поступлений. Добавьте зарплату или другой ожидаемый доход.
                </p>
              ) : (
                inflows.map((inflow) => (
                  <div
                    key={inflow.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inflow.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(inflow.expectedDate, true)} ·{' '}
                        <Badge
                          variant={
                            inflow.confidence === 'confirmed'
                              ? 'success'
                              : inflow.confidence === 'likely'
                                ? 'warning'
                                : 'outline'
                          }
                          className="align-middle"
                        >
                          {CONFIDENCE_LABEL[inflow.confidence]}
                        </Badge>
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular text-success">
                      +{formatMoney(inflow.amountMinor)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Изменить поступление"
                      onClick={() => startInflow(inflow)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Receipt className="h-4 w-4 text-primary" /> Обязательные платежи
                </h2>
                <p className="text-xs text-muted-foreground">Ежемесячные напоминания</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => startPayment()}>
                <Plus className="h-4 w-4" /> Добавить
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {payments.length === 0 ? (
                <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                  Нет обязательных платежей. Добавьте аренду, подписки или платёж по кредитке.
                </p>
              ) : (
                payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {payment.dayOfMonth}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{payment.name}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CalendarClock className="h-3 w-3" />
                        {formatDate(nextOccurrenceOfDay(payment.dayOfMonth), true)}
                        {!payment.active ? ' · выключен' : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular">{formatMoney(payment.amountMinor)}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Изменить платёж"
                      onClick={() => startPayment(payment)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" /> Расходы по категориям
          </h2>
          {summary.expenseByCategory.length === 0 ? (
            <p className="mt-3 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
              В этом месяце ещё нет расходов.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {summary.expenseByCategory.map((category) => {
                const width = Math.max(2, Math.round(category.share * 100));
                return (
                  <div key={category.categoryId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{category.name}</span>
                      <span className="shrink-0 tabular text-muted-foreground">
                        {formatMoney(category.amountMinor)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={budgetEditing}
        onClose={() => setBudgetEditing(false)}
        title={`Бюджет на ${formatMonth(month)}`}
        description="Сколько можно потратить за месяц, не считая переводов и погашения кредитки."
        footer={
          <Button className="h-11 w-full" onClick={() => void saveBudget()} disabled={budgetSaving}>
            {budgetSaving ? 'Сохраняем…' : 'Сохранить бюджет'}
          </Button>
        }
      >
        <Field label="Сумма бюджета" hint="Можно изменить в любой момент">
          <Input
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder="0"
          />
        </Field>
        <p className="mt-3 text-xs text-muted-foreground">
          Текущая настройка по умолчанию: {formatMoney(settings.monthlyBudgetMinor)}. Бюджет
          конкретного месяца хранится отдельно.
        </p>
      </Dialog>

      <Dialog
        open={paymentDialog}
        onClose={() => setPaymentDialog(false)}
        title={paymentEditing ? 'Изменить платёж' : 'Новый обязательный платёж'}
        footer={
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void savePayment()} disabled={dialogSaving}>
              {dialogSaving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {paymentEditing ? (
              <Button
                variant="outline"
                className="text-destructive"
                aria-label="Удалить платёж"
                onClick={() => void removePayment(paymentEditing)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Название">
            <Input
              value={paymentForm.name}
              onChange={(event) => setPaymentForm({ ...paymentForm, name: event.target.value })}
              placeholder="Аренда, интернет, кредитка"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Сумма">
              <Input
                value={paymentForm.amount}
                onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            <Field label="День месяца">
              <Input
                value={paymentForm.dayOfMonth}
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, dayOfMonth: event.target.value })
                }
                inputMode="numeric"
                placeholder="1–31"
              />
            </Field>
          </div>
          <Field label="Счёт списания" hint="Необязательно">
            <Select
              value={paymentForm.accountId}
              onChange={(event) => setPaymentForm({ ...paymentForm, accountId: event.target.value })}
            >
              <option value="">Не указан</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Заметка" hint="Необязательно">
            <Textarea
              value={paymentForm.note}
              onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })}
              rows={2}
            />
          </Field>
          {dialogError ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {dialogError}
            </p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={inflowDialog}
        onClose={() => setInflowDialog(false)}
        title={inflowEditing ? 'Изменить поступление' : 'Новое плановое поступление'}
        description="Ожидаемые деньги не увеличивают баланс, пока вы не запишете реальный доход."
        footer={
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void saveInflow()} disabled={dialogSaving}>
              {dialogSaving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {inflowEditing ? (
              <Button
                variant="outline"
                className="text-destructive"
                aria-label="Удалить поступление"
                onClick={() => void removeInflow(inflowEditing)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Название">
            <Input
              value={inflowForm.name}
              onChange={(event) => setInflowForm({ ...inflowForm, name: event.target.value })}
              placeholder="Зарплата"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Сумма">
              <Input
                value={inflowForm.amount}
                onChange={(event) => setInflowForm({ ...inflowForm, amount: event.target.value })}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            <Field label="Ожидаемая дата">
              <Input
                type="date"
                value={inflowForm.expectedDate}
                onChange={(event) =>
                  setInflowForm({ ...inflowForm, expectedDate: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Уверенность">
            <Select
              value={inflowForm.confidence}
              onChange={(event) =>
                setInflowForm({
                  ...inflowForm,
                  confidence: event.target.value as InflowConfidence,
                })
              }
            >
              <option value="confirmed">Подтверждено</option>
              <option value="likely">Вероятно</option>
              <option value="possible">Возможно</option>
            </Select>
          </Field>
          {dialogError ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {dialogError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
