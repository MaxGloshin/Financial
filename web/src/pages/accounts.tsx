import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { accountsWithBalances, moneyOverview } from '@/domain/finance.ts';
import type { Account, AccountType } from '@/domain/types.ts';
import type { LucideIcon } from 'lucide-react';
import { createAccount, deleteAccount, updateAccount } from '@/db/accounts.ts';
import { db } from '@/db/db.ts';
import { formatDate } from '@/lib/dates.ts';
import { formatMoney, formatMoneyInput, parseMoneyToMinor } from '@/lib/money.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { cn } from '@/lib/utils.ts';

const TYPE_LABEL: Record<AccountType, string> = {
  cash: 'Наличные',
  debit: 'Дебетовый',
  savings: 'Накопительный',
  credit: 'Кредитка',
};

const TYPE_ICON: Record<AccountType, LucideIcon> = {
  cash: Banknote,
  debit: Landmark,
  savings: PiggyBank,
  credit: CreditCard,
};

type FormState = {
  name: string;
  type: AccountType;
  opening: string;
  creditLimit: string;
  paymentDueDay: string;
  statementDay: string;
  archived: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  type: 'debit',
  opening: '',
  creditLimit: '',
  paymentDueDay: '',
  statementDay: '',
  archived: false,
};

function formFromAccount(account: Account): FormState {
  return {
    name: account.name,
    type: account.type,
    opening:
      account.type === 'credit'
        ? account.openingBalanceMinor < 0
          ? formatMoneyInput(-account.openingBalanceMinor)
          : ''
        : account.openingBalanceMinor
          ? formatMoneyInput(account.openingBalanceMinor)
          : '',
    creditLimit: account.creditLimitMinor ? formatMoneyInput(account.creditLimitMinor) : '',
    paymentDueDay: account.paymentDueDay ? String(account.paymentDueDay) : '',
    statementDay: account.statementDay ? String(account.statementDay) : '',
    archived: account.archived,
  };
}

export function AccountsPage() {
  const { snapshot, openQuickAdd } = useApp();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accounts = useMemo(() => accountsWithBalances(snapshot), [snapshot]);
  const overview = useMemo(() => moneyOverview(snapshot), [snapshot]);
  const own = accounts.filter((account) => account.type !== 'credit');
  const credit = accounts.filter((account) => account.type === 'credit');

  function startCreate(type: AccountType = 'debit') {
    setEditing(null);
    setForm({ ...EMPTY_FORM, type });
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }

  function startEdit(account: Account) {
    setEditing(account);
    setForm(formFromAccount(account));
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!form.name.trim()) throw new Error('Введите название счёта');
      const opening = parseMoneyToMinor(form.opening || '0');
      const creditLimit = form.creditLimit ? parseMoneyToMinor(form.creditLimit) : 0;
      const paymentDueDay = form.paymentDueDay ? Number(form.paymentDueDay) : undefined;
      const statementDay = form.statementDay ? Number(form.statementDay) : undefined;
      const input = {
        name: form.name,
        type: form.type,
        openingBalanceMinor: form.type === 'credit' ? -Math.abs(opening) : opening,
        creditLimitMinor: form.type === 'credit' ? creditLimit : undefined,
        paymentDueDay,
        statementDay,
      };
      if (editing) {
        const updated = await updateAccount(db, editing.id, {
          ...input,
          archived: form.archived,
        });
        toast({ title: 'Счёт обновлён', description: updated.name, variant: 'success' });
      } else {
        const created = await createAccount(db, input);
        toast({ title: 'Счёт добавлен', description: created.name, variant: 'success' });
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить счёт');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteAccount(db, editing.id);
      toast({ title: 'Счёт удалён', variant: 'success' });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить счёт');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Счета</h1>
          <p className="text-sm text-muted-foreground">
            Баланс = стартовый остаток + все операции. Кредитка хранит долг отдельно.
          </p>
        </div>
        <Button onClick={() => startCreate()}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Счёт</span>
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Собственные деньги</p>
            <p className="text-lg font-semibold tabular">{formatMoney(overview.ownFundsMinor)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Наличные</p>
            <p className="text-lg font-semibold tabular">{formatMoney(overview.cashMinor)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">На счетах</p>
            <p className="text-lg font-semibold tabular">
              {formatMoney(overview.debitMinor + overview.savingsMinor)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Долг кредитки</p>
            <p className="text-lg font-semibold tabular text-destructive">
              {formatMoney(overview.creditDebtMinor)}
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Свои деньги
          </h2>
          <Button variant="ghost" size="sm" onClick={() => openQuickAdd('transfer')}>
            <ArrowLeftRight className="h-4 w-4" /> Перевести
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {own.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onEdit={() => startEdit(account)}
              onAdd={() => openQuickAdd('expense')}
            />
          ))}
          {own.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Добавьте наличные или дебетовый счёт.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Кредитные счета
          </h2>
          {credit.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => openQuickAdd('credit_payment')}>
              <CreditCard className="h-4 w-4" /> Погасить
            </Button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {credit.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onEdit={() => startEdit(account)}
              onAdd={() => openQuickAdd('credit_payment')}
            />
          ))}
          {credit.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Кредитных счетов нет.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <p className="px-1 text-xs text-muted-foreground">
        Стартовый остаток — это сумма на момент начала учёта, а не текущий баланс. После изменения
        стартового остатка все расчёты пересчитаются.
      </p>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Изменить счёт' : 'Новый счёт'}
        footer={
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                className="text-destructive"
                aria-label="Удалить счёт"
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
              <p className="text-sm font-medium">Удалить счёт?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Удалить можно только счёт без операций. Иначе используйте архивирование.
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

          <Field label="Название">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Например, Зарплатная карта"
              autoFocus
            />
          </Field>

          <Field label="Тип счёта">
            <Select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as AccountType })}
            >
              <option value="cash">Наличные</option>
              <option value="debit">Дебетовый</option>
              <option value="savings">Накопительный</option>
              <option value="credit">Кредитка</option>
            </Select>
          </Field>

          <Field
            label={form.type === 'credit' ? 'Задолженность на старте' : 'Стартовый остаток'}
            hint={
              form.type === 'credit'
                ? 'Введите долг положительным числом. Кредитный лимит не входит в собственные деньги.'
                : 'Сумма на счёте в момент начала учёта.'
            }
          >
            <Input
              value={form.opening}
              onChange={(event) => setForm({ ...form, opening: event.target.value })}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>

          {form.type === 'credit' ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Кредитный лимит">
                <Input
                  value={form.creditLimit}
                  onChange={(event) => setForm({ ...form, creditLimit: event.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                />
              </Field>
              <Field label="День платежа">
                <Input
                  value={form.paymentDueDay}
                  onChange={(event) => setForm({ ...form, paymentDueDay: event.target.value })}
                  inputMode="numeric"
                  placeholder="1–31"
                />
              </Field>
            </div>
          ) : null}

          {editing ? (
            <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
              <input
                type="checkbox"
                checked={form.archived}
                onChange={(event) => setForm({ ...form, archived: event.target.checked })}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              Архивировать счёт (не участвует в балансе)
            </label>
          ) : null}

          {error ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}

function AccountCard({
  account,
  onEdit,
  onAdd,
}: {
  account: Account & { balanceMinor: number };
  onEdit: () => void;
  onAdd: () => void;
}) {
  const Icon = TYPE_ICON[account.type];
  const isCredit = account.type === 'credit';
  const debt = Math.max(0, -account.balanceMinor);
  const available =
    isCredit && account.creditLimitMinor
      ? Math.max(0, account.creditLimitMinor - debt)
      : null;
  return (
    <Card className={cn(account.archived && 'opacity-60')}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"
            style={account.color ? { backgroundColor: `${account.color}20`, color: account.color } : undefined}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{account.name}</p>
              {account.archived ? <Badge variant="outline">архив</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">{TYPE_LABEL[account.type]}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Изменить счёт" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
        <p className={cn('mt-3 text-2xl font-semibold tabular', isCredit && debt > 0 && 'text-destructive')}>
          {isCredit ? formatMoney(debt) : formatMoney(account.balanceMinor)}
        </p>
        {isCredit ? (
          <p className="text-xs text-muted-foreground">
            {account.creditLimitMinor
              ? `Лимит ${formatMoney(account.creditLimitMinor)} · доступно ${formatMoney(available ?? 0)}`
              : 'Лимит не указан'}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Стартовый остаток {formatMoney(account.openingBalanceMinor)} ·{' '}
            {formatDate(account.openingBalanceAt)}
          </p>
        )}
        <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-primary" onClick={onAdd}>
          {isCredit ? 'Погасить кредитку' : 'Добавить операцию'}
        </Button>
      </CardContent>
    </Card>
  );
}
