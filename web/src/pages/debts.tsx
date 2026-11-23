import { useMemo, useState } from 'react';
import { CalendarDays, Coins, CreditCard, HandCoins, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { debtRemaining, moneyOverview } from '@/domain/finance.ts';
import type { Debt, DebtDirection } from '@/domain/types.ts';
import { createDebt, deleteDebt, updateDebt } from '@/db/planning.ts';
import { createTransaction, deleteTransaction } from '@/db/transactions.ts';
import { db } from '@/db/db.ts';
import { formatDate, nowIso } from '@/lib/dates.ts';
import { formatMoney, formatMoneyInput, percent, parseMoneyToMinor } from '@/lib/money.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input, Select, Textarea } from '@/components/ui/input.tsx';
import { SegmentedControl } from '@/components/ui/segmented.tsx';
import { cn } from '@/lib/utils.ts';

type Tab = 'owed_to_me' | 'i_owe';

export function DebtsPage() {
  const { snapshot } = useApp();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('owed_to_me');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Debt | null>(null);
  const [form, setForm] = useState({
    direction: 'owed_to_me' as DebtDirection,
    counterparty: '',
    amount: '',
    dueDate: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [paymentDebt, setPaymentDebt] = useState<Debt | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const overview = useMemo(() => moneyOverview(snapshot), [snapshot]);
  const debts = snapshot.debts
    .filter((debt) => !debt.deletedAt)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const filtered = debts.filter((debt) => debt.direction === tab);
  const openDebts = debts.filter((debt) => debt.status !== 'paid');
  const totalFor = (direction: DebtDirection) =>
    debts
      .filter((debt) => debt.direction === direction && debt.status !== 'paid')
      .reduce((total, debt) => total + debtRemaining(debt), 0);

  const accounts = snapshot.accounts.filter(
    (account) => !account.archived && account.type !== 'credit',
  );

  function startCreate() {
    setEditing(null);
    setForm({
      direction: tab,
      counterparty: '',
      amount: '',
      dueDate: '',
      note: '',
    });
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }

  function startEdit(debt: Debt) {
    setEditing(debt);
    setForm({
      direction: debt.direction,
      counterparty: debt.counterparty,
      amount: formatMoneyInput(debt.amountMinor),
      dueDate: debt.dueDate ?? '',
      note: debt.note ?? '',
    });
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const amountMinor = parseMoneyToMinor(form.amount);
      const input = {
        direction: form.direction,
        counterparty: form.counterparty,
        amountMinor,
        dueDate: form.dueDate || null,
        note: form.note,
      };
      if (editing) {
        await updateDebt(db, editing.id, input);
        toast({ title: 'Долг обновлён', variant: 'success' });
      } else {
        await createDebt(db, input);
        toast({ title: 'Долг добавлен', variant: 'success' });
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить долг');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteDebt(db, editing.id);
      toast({ title: 'Долг удалён', variant: 'success' });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить долг');
    } finally {
      setSaving(false);
    }
  }

  function startPayment(debt: Debt) {
    setPaymentDebt(debt);
    setPaymentAmount(formatMoneyInput(debtRemaining(debt)));
    setPaymentAccount(accounts[0]?.id ?? '');
    setPaymentError(null);
  }

  async function pay() {
    if (!paymentDebt || paymentSaving) return;
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      const amountMinor = parseMoneyToMinor(paymentAmount);
      if (!paymentAccount) throw new Error('Выберите счёт');
      const transaction = await createTransaction(db, {
        kind: 'debt_payment',
        amountMinor,
        accountId: paymentAccount,
        debtId: paymentDebt.id,
        occurredAt: nowIso(),
        description: `Долг · ${paymentDebt.counterparty}`,
      });
      toast({
        title: 'Платёж по долгу записан',
        description:
          paymentDebt.direction === 'owed_to_me'
            ? 'Деньги пришли на счёт. Это не доход.'
            : 'Деньги ушли со счёта. Это не расход.',
        variant: 'success',
        action: {
          label: 'Отменить',
          onClick: async () => {
            try {
              await deleteTransaction(db, transaction.id);
            } catch (caught) {
              toast({
                title: 'Не удалось отменить',
                description: caught instanceof Error ? caught.message : undefined,
                variant: 'error',
              });
            }
          },
        },
      });
      setPaymentDebt(null);
    } catch (caught) {
      setPaymentError(caught instanceof Error ? caught.message : 'Не удалось записать платёж');
    } finally {
      setPaymentSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Долги</h1>
          <p className="text-sm text-muted-foreground">
            Долги вне кредитки. Возврат долга не считается доходом или расходом.
          </p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Долг</span>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Мне должны</p>
            <p className="mt-1 text-xl font-semibold tabular text-success">
              {formatMoney(totalFor('owed_to_me'))}
            </p>
            <p className="text-[11px] text-muted-foreground">Не входит в собственные деньги</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Я должен</p>
            <p className="mt-1 text-xl font-semibold tabular text-destructive">
              {formatMoney(totalFor('i_owe'))}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Уменьшает чистую стоимость, но не баланс счетов
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Долг кредитки</p>
            <p className="mt-1 text-xl font-semibold tabular">{formatMoney(overview.creditDebtMinor)}</p>
            <Link to="/accounts" className="text-[11px] text-primary">
              Открыть счета
            </Link>
          </CardContent>
        </Card>
      </div>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: 'owed_to_me' as Tab, label: 'Мне должны' },
          { value: 'i_owe' as Tab, label: 'Я должен' },
        ]}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Coins className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Здесь пока пусто</p>
            <p className="text-sm text-muted-foreground">
              {tab === 'owed_to_me'
                ? 'Добавьте, если кто-то должен вам деньги.'
                : 'Добавьте, если вы должны кому-то.'}
            </p>
            <Button className="mt-2" onClick={startCreate}>
              <Plus className="h-4 w-4" /> Добавить долг
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((debt) => {
            const remaining = debtRemaining(debt);
            const paidPercent = percent(debt.paidMinor, debt.amountMinor);
            return (
              <Card key={debt.id} className={cn(debt.status === 'paid' && 'opacity-70')}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{debt.counterparty}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={
                            debt.direction === 'owed_to_me' ? 'success' : 'destructive'
                          }
                        >
                          {debt.direction === 'owed_to_me' ? 'мне должны' : 'я должен'}
                        </Badge>
                        {debt.status === 'paid' ? <Badge variant="outline">закрыт</Badge> : null}
                        {debt.dueDate ? (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <CalendarDays className="h-3 w-3" /> {formatDate(debt.dueDate, true)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Изменить долг"
                      onClick={() => startEdit(debt)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>

                  <p className="mt-3 text-2xl font-semibold tabular">
                    {formatMoney(remaining)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">остаток</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Из {formatMoney(debt.amountMinor)} · выплачено {formatMoney(debt.paidMinor)}
                  </p>
                  <Progress value={paidPercent} className="mt-2" />
                  {debt.note ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{debt.note}</p>
                  ) : null}

                  {debt.status !== 'paid' ? (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => startPayment(debt)}>
                        <HandCoins className="h-4 w-4" />
                        {debt.direction === 'owed_to_me' ? 'Получить' : 'Выплатить'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => startEdit(debt)}>
                        Изменить
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Кредитка учитывается как отдельный счёт: покупка увеличивает долг, погашение уменьшает,
            но не попадает в расходы повторно.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Изменить долг' : 'Новый долг'}
        footer={
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                className="text-destructive"
                aria-label="Удалить долг"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-3">
          {confirmDelete ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm font-medium">Удалить долг?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                История платежей по нему останется в операциях.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => void remove()}>
                  Удалить
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          ) : null}

          <Field label="Направление">
            <Select
              value={form.direction}
              onChange={(event) =>
                setForm({ ...form, direction: event.target.value as DebtDirection })
              }
            >
              <option value="owed_to_me">Мне должны</option>
              <option value="i_owe">Я должен</option>
            </Select>
          </Field>
          <Field label="Кто">
            <Input
              value={form.counterparty}
              onChange={(event) => setForm({ ...form, counterparty: event.target.value })}
              placeholder="Имя или описание"
              autoFocus
            />
          </Field>
          <Field label="Сумма долга">
            <Input
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
          <Field label="Вернуть до" hint="Необязательно">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
            />
          </Field>
          <Field label="Заметка" hint="Необязательно">
            <Textarea
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              rows={2}
            />
          </Field>
          {editing && editing.paidMinor > 0 ? (
            <p className="text-xs text-muted-foreground">
              Уже выплачено {formatMoney(editing.paidMinor)}. Сумма долга не может быть меньше
              выплаченного.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={paymentDebt !== null}
        onClose={() => setPaymentDebt(null)}
        title={
          paymentDebt?.direction === 'owed_to_me' ? 'Получить возврат долга' : 'Выплатить долг'
        }
        description={
          paymentDebt
            ? `${paymentDebt.counterparty} · остаток ${formatMoney(debtRemaining(paymentDebt))}`
            : undefined
        }
        footer={
          <Button className="h-11 w-full" onClick={() => void pay()} disabled={paymentSaving}>
            {paymentSaving ? 'Записываем…' : 'Записать платёж'}
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Сумма">
            <Input
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              inputMode="decimal"
              autoFocus
            />
          </Field>
          <Field
            label={paymentDebt?.direction === 'owed_to_me' ? 'Куда пришли деньги' : 'Откуда ушли деньги'}
          >
            <Select
              value={paymentAccount}
              onChange={(event) => setPaymentAccount(event.target.value)}
            >
              <option value="">Выберите счёт</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Платёж изменит баланс счёта и остаток долга. В доходы и расходы он не попадёт.
          </p>
          {paymentError ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {paymentError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
