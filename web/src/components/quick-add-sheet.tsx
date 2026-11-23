import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calculator,
  CreditCard,
  HandCoins,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input, Field, Select, Textarea } from '@/components/ui/input.tsx';
import { SegmentedControl } from '@/components/ui/segmented.tsx';
import { CategoryIcon } from '@/components/category-icon.tsx';
import { cn } from '@/lib/utils.ts';
import { evaluateAmountExpression, isExpression } from '@/lib/calc.ts';
import { formatMoneyInput, parseMoneyToMinor } from '@/lib/money.ts';
import { fromDateTimeLocalValue, nowIso, toDateTimeLocalValue } from '@/lib/dates.ts';
import { newId } from '@/lib/id.ts';
import type { Transaction, TransactionDraft, TransactionKind } from '@/domain/types.ts';
import { transactionKindLabel } from '@/domain/postings.ts';
import {
  createTransaction,
  deleteTransaction,
  restoreTransaction,
  updateTransaction,
} from '@/db/transactions.ts';
import { updateSettings } from '@/db/settings.ts';
import { db } from '@/db/db.ts';

const KIND_OPTIONS: Array<{
  value: TransactionKind;
  label: string;
  icon: ReactNode;
}> = [
  { value: 'expense', label: 'Расход', icon: <ArrowUpRight className="h-4 w-4" /> },
  { value: 'income', label: 'Доход', icon: <ArrowDownLeft className="h-4 w-4" /> },
  { value: 'transfer', label: 'Перевод', icon: <ArrowLeftRight className="h-4 w-4" /> },
  { value: 'credit_payment', label: 'Кредитка', icon: <CreditCard className="h-4 w-4" /> },
  { value: 'debt_payment', label: 'Долг', icon: <HandCoins className="h-4 w-4" /> },
  { value: 'refund', label: 'Возврат', icon: <RotateCcw className="h-4 w-4" /> },
];

function draftFromTransaction(transaction: Transaction): TransactionDraft {
  return {
    kind: transaction.kind,
    amountMinor: transaction.amountMinor,
    occurredAt: transaction.occurredAt,
    description: transaction.description,
    accountId: transaction.accountId,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    categoryId: transaction.categoryId,
    debtId: transaction.debtId,
    clientRequestId: transaction.clientRequestId,
    source: transaction.source,
  };
}

export function QuickAddSheet() {
  const { snapshot, settings, quickAdd, closeQuickAdd } = useApp();
  const { toast } = useToast();
  const [kind, setKind] = useState<TransactionKind>(quickAdd.kind);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [debtId, setDebtId] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowIso());
  const [showDate, setShowDate] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const clientRequestId = useRef(newId());

  const editing = quickAdd.editing;
  const activeAccounts = snapshot.accounts.filter((account) => !account.archived);
  const nonCreditAccounts = activeAccounts.filter((account) => account.type !== 'credit');
  const creditAccounts = activeAccounts.filter((account) => account.type === 'credit');
  const categories = snapshot.categories.filter((category) =>
    kind === 'income' ? category.kind === 'income' : category.kind === 'expense',
  );
  const openDebts = snapshot.debts.filter(
    (debt) => !debt.deletedAt && debt.status !== 'paid' && debt.amountMinor > debt.paidMinor,
  );
  const editingDebt =
    editing?.debtId && editing.kind === 'debt_payment'
      ? snapshot.debts.find((debt) => debt.id === editing.debtId && !debt.deletedAt)
      : undefined;
  const debtOptions =
    editingDebt && !openDebts.some((debt) => debt.id === editingDebt.id)
      ? [editingDebt, ...openDebts]
      : openDebts;

  const effectiveKind: TransactionKind =
    kind === 'debt_payment' && openDebts.length === 0 && !editing ? 'expense' : kind;

  const accountOptions =
    effectiveKind === 'income'
      ? nonCreditAccounts
      : effectiveKind === 'transfer'
        ? nonCreditAccounts
        : effectiveKind === 'credit_payment'
          ? nonCreditAccounts
          : activeAccounts;

  const expression = useMemo(() => {
    const text = amount.trim();
    if (!text) return { minor: null as number | null, error: null as string | null, computed: false };
    try {
      if (isExpression(text)) {
        return { minor: evaluateAmountExpression(text), error: null, computed: true };
      }
      return { minor: parseMoneyToMinor(text), error: null, computed: false };
    } catch (caught) {
      return {
        minor: null,
        error: caught instanceof Error ? caught.message : 'Проверьте сумму',
        computed: false,
      };
    }
  }, [amount]);

  const recentCategories = useMemo(() => {
    const cutoff = Date.now() - 90 * 86_400_000;
    const counts = new Map<string, number>();
    for (const transaction of snapshot.transactions) {
      if (transaction.deletedAt || transaction.occurredAt < new Date(cutoff).toISOString()) continue;
      if (transaction.categoryId) {
        counts.set(transaction.categoryId, (counts.get(transaction.categoryId) ?? 0) + 1);
      }
    }
    return [...categories].sort((a, b) => {
      const countDiff = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
      if (countDiff !== 0) return countDiff;
      return a.sortOrder - b.sortOrder;
    });
  }, [categories, snapshot.transactions]);

  useEffect(() => {
    if (!quickAdd.open) return;
    setError(null);
    setShowDate(false);
    setShowAllCategories(false);
    setSaving(false);
    setConfirmDelete(false);
    const startKind = quickAdd.kind;
    setKind(startKind);
    if (editing) {
      setAmount(editing.amountMinor === 0 ? '' : formatMoneyInput(editing.amountMinor));
      setCategoryId(editing.categoryId ?? '');
      setAccountId(editing.accountId ?? '');
      setFromAccountId(editing.fromAccountId ?? '');
      setToAccountId(editing.toAccountId ?? '');
      setDebtId(editing.debtId ?? '');
      setDescription(editing.description);
      setOccurredAt(editing.occurredAt);
      clientRequestId.current = editing.clientRequestId;
      return;
    }
    setAmount('');
    setDescription('');
    setOccurredAt(nowIso());
    clientRequestId.current = newId();
    const preferredCategory =
      startKind === 'income'
        ? snapshot.categories.find(
            (category) => category.kind === 'income' && category.id === settings.lastCategoryId,
          )
        : snapshot.categories.find(
            (category) => category.kind === 'expense' && category.id === settings.lastCategoryId,
          );
    setCategoryId(preferredCategory?.id ?? '');
    const preferredAccount =
      snapshot.accounts.find(
        (account) => account.id === settings.defaultAccountId && !account.archived,
      ) ??
      snapshot.accounts.find((account) => account.type === 'debit' && !account.archived) ??
      snapshot.accounts.find((account) => !account.archived);
    setAccountId(preferredAccount?.id ?? '');
    setFromAccountId(preferredAccount?.id ?? '');
    const savings = snapshot.accounts.find((account) => account.type === 'savings' && !account.archived);
    setToAccountId(
      startKind === 'credit_payment'
        ? (creditAccounts[0]?.id ?? '')
        : (savings?.id ?? snapshot.accounts.find((a) => a.type === 'cash')?.id ?? ''),
    );
    setDebtId(openDebts[0]?.id ?? '');
  }, [quickAdd.open, editing?.id]);

  useEffect(() => {
    if (editing || !quickAdd.open) return;
    if (!categories.some((category) => category.id === categoryId)) {
      const preferred = categories.find((category) => category.id === settings.lastCategoryId);
      setCategoryId(preferred?.id ?? categories[0]?.id ?? '');
    }
  }, [kind, categories, categoryId, settings.lastCategoryId, quickAdd.open, editing]);

  useEffect(() => {
    if (editing || !quickAdd.open) return;
    if ((effectiveKind === 'transfer' || effectiveKind === 'credit_payment') && !fromAccountId) {
      const debit = snapshot.accounts.find((account) => account.type === 'debit' && !account.archived);
      setFromAccountId(debit?.id ?? nonCreditAccounts[0]?.id ?? '');
    }
    if (effectiveKind === 'credit_payment' && !toAccountId) {
      setToAccountId(creditAccounts[0]?.id ?? '');
    }
    if (effectiveKind === 'debt_payment' && !debtId) setDebtId(openDebts[0]?.id ?? '');
  }, [effectiveKind, quickAdd.open, editing, fromAccountId, toAccountId, debtId]);

  const selectedDebt = debtOptions.find((debt) => debt.id === debtId);
  const selectedAccount = activeAccounts.find((account) => account.id === accountId);

  async function handleSubmit() {
    if (saving) return;
    setError(null);
    const minor = expression.minor;
    if (minor === null || Number.isNaN(minor)) {
      setError(expression.error ?? 'Введите сумму');
      return;
    }
    if (effectiveKind !== 'adjustment' && minor <= 0) {
      setError('Сумма должна быть больше нуля');
      return;
    }
    if ((effectiveKind === 'expense' || effectiveKind === 'refund' || effectiveKind === 'income') && !categoryId) {
      setError('Выберите категорию');
      return;
    }
    if (effectiveKind === 'transfer') {
      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        setError('Выберите два разных счёта');
        return;
      }
    }
    if (effectiveKind === 'credit_payment' && !toAccountId) {
      setError('Выберите кредитный счёт');
      return;
    }
    if (effectiveKind === 'debt_payment' && !debtId) {
      setError('Выберите долг');
      return;
    }

    const draft: TransactionDraft = {
      kind: effectiveKind,
      amountMinor: minor,
      occurredAt,
      description,
      ...(effectiveKind === 'transfer' || effectiveKind === 'credit_payment'
        ? { fromAccountId, toAccountId }
        : { accountId }),
      ...((effectiveKind === 'expense' || effectiveKind === 'income' || effectiveKind === 'refund')
        ? { categoryId }
        : {}),
      ...(effectiveKind === 'debt_payment' ? { debtId } : {}),
      clientRequestId: clientRequestId.current,
      source: editing?.source === 'demo' ? 'manual' : (editing?.source ?? 'manual'),
    };

    setSaving(true);
    try {
      if (editing) {
        const before = draftFromTransaction(editing);
        await updateTransaction(db, editing.id, draft);
        toast({
          title: 'Операция изменена',
          description: `${transactionKindLabel(effectiveKind)} · ${formatMoneyInput(minor)} ₽`,
          variant: 'success',
          action: {
            label: 'Отменить',
            onClick: async () => {
              try {
                await updateTransaction(db, editing.id, before);
              } catch (caught) {
                toast({
                  title: 'Не удалось отменить изменение',
                  description: caught instanceof Error ? caught.message : undefined,
                  variant: 'error',
                });
              }
            },
          },
        });
      } else {
        const created = await createTransaction(db, draft);
        toast({
          title: 'Операция сохранена',
          description: `${transactionKindLabel(effectiveKind)} · ${formatMoneyInput(minor)} ₽`,
          variant: 'success',
          action: {
            label: 'Отменить',
            onClick: async () => {
              try {
                await deleteTransaction(db, created.id);
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
      }
      void updateSettings(db, {
        defaultAccountId:
          effectiveKind === 'transfer' || effectiveKind === 'credit_payment'
            ? fromAccountId
            : accountId,
        ...(categoryId ? { lastCategoryId: categoryId } : {}),
      }).catch(() => undefined);
      closeQuickAdd();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить операцию');
    } finally {
      setSaving(false);
    }
  }

  const needsCategory =
    effectiveKind === 'expense' || effectiveKind === 'income' || effectiveKind === 'refund';
  const isAccountKind =
    effectiveKind === 'expense' ||
    effectiveKind === 'income' ||
    effectiveKind === 'refund' ||
    effectiveKind === 'debt_payment';
  const title = editing ? 'Изменить операцию' : 'Новая операция';
  const saveLabel = editing
    ? 'Сохранить изменения'
    : effectiveKind === 'income'
      ? 'Добавить доход'
      : effectiveKind === 'expense'
        ? 'Добавить расход'
        : 'Сохранить';

  async function handleDelete() {
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteTransaction(db, editing.id);
      toast({
        title: 'Операция удалена',
        description: `${transactionKindLabel(editing.kind)} · ${formatMoneyInput(editing.amountMinor)} ₽`,
        variant: 'success',
        action: {
          label: 'Отменить',
          onClick: async () => {
            try {
              await restoreTransaction(db, editing.id);
            } catch (caught) {
              toast({
                title: 'Не удалось восстановить операцию',
                description: caught instanceof Error ? caught.message : undefined,
                variant: 'error',
              });
            }
          },
        },
      });
      closeQuickAdd();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить операцию');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={quickAdd.open}
      onClose={closeQuickAdd}
      title={title}
      description={editing ? transactionKindLabel(editing.kind) : 'Проверьте сумму и категорию'}
      footer={
        editing ? (
          <div className="flex gap-2">
            <Button
              className="h-12 flex-1 text-base"
              onClick={() => void handleSubmit()}
              disabled={saving}
            >
              {saving ? 'Сохраняем…' : saveLabel}
            </Button>
            <Button
              variant="outline"
              className="h-12 px-3 text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              Удалить
            </Button>
          </div>
        ) : (
          <Button
            className="h-12 w-full text-base"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving ? 'Сохраняем…' : saveLabel}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {editing && confirmDelete ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
            <p className="text-sm font-medium">Удалить операцию?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Баланс пересчитается. В течение нескольких секунд удаление можно отменить.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                Да, удалить
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Оставить
              </Button>
            </div>
          </div>
        ) : null}
        {!editing ? (
          <SegmentedControl
            value={effectiveKind}
            onChange={(next) => setKind(next)}
            options={
              openDebts.length === 0
                ? KIND_OPTIONS.filter((option) => option.value !== 'debt_payment')
                : KIND_OPTIONS
            }
            size="sm"
          />
        ) : null}

        <div className="rounded-2xl border border-border bg-background p-3">
          <label className="sr-only" htmlFor="quick-amount">
            Сумма
          </label>
          <div className="flex items-center gap-2">
            <input
              id="quick-amount"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              inputMode="decimal"
              autoFocus
              placeholder="0"
              className="min-w-0 flex-1 bg-transparent text-4xl font-semibold tabular outline-none placeholder:text-muted-foreground/50"
            />
            <span className="text-3xl font-semibold text-muted-foreground">₽</span>
          </div>
          <div className="mt-1 flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
            {expression.computed && expression.minor !== null ? (
              <>
                <Calculator className="h-3.5 w-3.5" />
                <span>= {formatMoneyInput(expression.minor)} ₽</span>
              </>
            ) : (
              <span>Можно считать: 1200+350 или 100*3</span>
            )}
          </div>
        </div>

        {needsCategory ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Категория</span>
              <button
                type="button"
                onClick={() => setShowAllCategories((value) => !value)}
                className="text-xs font-medium text-primary"
              >
                {showAllCategories ? 'Скрыть' : 'Все категории'}
              </button>
            </div>
            <div
              className={cn(
                'grid gap-2',
                showAllCategories ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3',
              )}
            >
              {(showAllCategories ? categories : recentCategories.slice(0, 6)).map((category) => {
                const selected = category.id === categoryId;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setCategoryId(category.id)}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-border bg-card hover:bg-muted',
                    )}
                  >
                    <CategoryIcon
                      name={category.icon}
                      color={category.color}
                      className="h-8 w-8"
                    />
                    <span className="min-w-0 truncate">{category.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {isAccountKind ? (
          <Field label={effectiveKind === 'debt_payment' ? 'Куда/откуда деньги' : 'Счёт'}>
            <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Выберите счёт</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.type === 'credit' ? ' (кредитка, увеличит долг)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {effectiveKind === 'transfer' || effectiveKind === 'credit_payment' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Со счёта">
              <Select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}>
                <option value="">Счёт</option>
                {nonCreditAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={effectiveKind === 'credit_payment' ? 'На кредитку' : 'На счёт'}>
              <Select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                <option value="">Счёт</option>
                {(effectiveKind === 'credit_payment' ? creditAccounts : nonCreditAccounts).map(
                  (account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ),
                )}
              </Select>
            </Field>
          </div>
        ) : null}

        {effectiveKind === 'debt_payment' ? (
          <Field
            label="Долг"
            hint={
              selectedDebt
                ? `Остаток: ${formatMoneyInput(
                    selectedDebt.amountMinor - selectedDebt.paidMinor,
                  )} ₽ · ${
                    selectedDebt.direction === 'owed_to_me' ? 'мне должны' : 'я должен'
                  }`
                : undefined
            }
          >
            <Select value={debtId} onChange={(event) => setDebtId(event.target.value)}>
              <option value="">Выберите долг</option>
              {debtOptions.map((debt) => (
                <option key={debt.id} value={debt.id}>
                  {debt.counterparty} ·{' '}
                  {debt.direction === 'owed_to_me' ? 'мне должны' : 'я должен'}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {selectedAccount?.type === 'credit' && effectiveKind === 'expense' ? (
          <p className="rounded-xl bg-warning/15 px-3 py-2 text-xs text-muted-foreground">
            Расход с кредитки увеличит долг. Кредитный лимит не считается своими деньгами.
          </p>
        ) : null}

        {effectiveKind === 'debt_payment' && selectedDebt ? (
          <p className="text-xs text-muted-foreground">
            {selectedDebt.direction === 'owed_to_me'
              ? 'Деньги придут на выбранный счёт. Это не доход.'
              : 'Деньги уйдут с выбранного счёта. Это не расход.'}
          </p>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDate((value) => !value)}
            className="text-xs font-medium text-primary"
          >
            {showDate ? 'Скрыть дату и время' : `Когда: ${new Date(occurredAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </button>
          {showDate ? (
            <Field label="Дата и время">
              <Input
                type="datetime-local"
                value={toDateTimeLocalValue(occurredAt)}
                onChange={(event) => setOccurredAt(fromDateTimeLocalValue(event.target.value))}
              />
            </Field>
          ) : null}
        </div>

        <Field label="Комментарий" hint="Необязательно">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Например, продукты в пятёрочке"
            maxLength={500}
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {editing ? (
          <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> {transactionKindLabel(editing.kind)}
            </span>
            <span>Изменение сохранится в истории</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
