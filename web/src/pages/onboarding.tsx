import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ImportBackupDialog } from '@/components/backup/import-dialog.tsx';
import { completeOnboarding } from '@/db/onboarding.ts';
import { db } from '@/db/db.ts';
import { parseMoneyToMinor } from '@/lib/money.ts';
import { cn } from '@/lib/utils.ts';

type PaymentRow = { name: string; amount: string; day: string };

function amount(value: string, field: string): number {
  if (!value.trim()) return 0;
  const parsed = parseMoneyToMinor(value);
  if (parsed < 0) throw new Error(`${field}: сумма не может быть отрицательной`);
  return parsed;
}

export function OnboardingPage() {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [cash, setCash] = useState('');
  const [debit, setDebit] = useState('');
  const [creditDebt, setCreditDebt] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [owed, setOwed] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [budget, setBudget] = useState('');
  const [income, setIncome] = useState('');
  const [incomeDay, setIncomeDay] = useState('10');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  function next() {
    setError(null);
    try {
      if (step === 0) {
        amount(cash, 'Наличные');
        amount(debit, 'Дебетовые счета');
        amount(creditDebt, 'Долг кредитки');
        amount(creditLimit, 'Кредитный лимит');
      }
      if (step === 1) {
        amount(owed, 'Долги мне');
        amount(budget, 'Бюджет');
        amount(income, 'Регулярный доход');
        const day = Number(incomeDay);
        if (incomeDay && (!Number.isInteger(day) || day < 1 || day > 31)) {
          throw new Error('День поступления должен быть от 1 до 31');
        }
      }
      if (step === 2) {
        for (const payment of payments) {
          if (!payment.name.trim() && !payment.amount.trim()) continue;
          if (!payment.name.trim()) throw new Error('У платежа должно быть название');
          amount(payment.amount, payment.name);
          const day = Number(payment.day);
          if (!Number.isInteger(day) || day < 1 || day > 31) {
            throw new Error('День платежа должен быть от 1 до 31');
          }
        }
      }
      setStep((current) => Math.min(2, current + 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Проверьте значения');
    }
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await completeOnboarding(db, {
        cashMinor: amount(cash, 'Наличные'),
        debitMinor: amount(debit, 'Дебетовые счета'),
        creditDebtMinor: amount(creditDebt, 'Долг кредитки'),
        creditLimitMinor: amount(creditLimit, 'Кредитный лимит'),
        owedToMeMinor: amount(owed, 'Долги мне'),
        owedToMeCounterparty: counterparty || 'Мне должны',
        monthlyBudgetMinor: amount(budget, 'Бюджет'),
        regularIncomeMinor: amount(income, 'Регулярный доход'),
        regularIncomeDay: Number(incomeDay) || 10,
        payments: payments
          .filter((payment) => payment.name.trim() && payment.amount.trim())
          .map((payment) => ({
            name: payment.name,
            amountMinor: amount(payment.amount, payment.name),
            dayOfMonth: Number(payment.day),
          })),
      });
      toast({
        title: 'Настройка завершена',
        description: 'Данные сохранены только в этом браузере. Сделайте резервную копию.',
        variant: 'success',
        duration: 8000,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось завершить настройку');
      setSaving(false);
    }
  }

  const titles = ['Деньги сейчас', 'Планы на месяц', 'Обязательные платежи'];

  return (
    <div className="min-h-dvh bg-background px-3 py-6 md:py-12">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">Мои финансы</p>
            <p className="text-xs text-muted-foreground">Локальный учёт без сервера</p>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Импорт
          </Button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Шаг {step + 1} из 3</span>
            <span>{titles[step]}</span>
          </div>
          <Progress value={((step + 1) / 3) * 100} />
        </div>

        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <h1 className="text-xl font-semibold">{titles[step]}</h1>
              <p className="text-sm text-muted-foreground">
                {step === 0
                  ? 'Введите суммы на сегодня. Это стартовые остатки, их можно изменить позже.'
                  : step === 1
                    ? 'Планы не увеличивают баланс. Ожидаемые доходы показываются отдельно.'
                    : 'Напомним о ближайшем платеже. Можно пропустить и добавить позже.'}
              </p>
            </div>

            {step === 0 ? (
              <div className="space-y-3">
                <Field label="Наличные, ₽" hint="Сумма в кошельке сейчас">
                  <Input
                    value={cash}
                    onChange={(event) => setCash(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    autoFocus
                  />
                </Field>
                <Field label="На дебетовых счетах, ₽" hint="Карты и вклады, которыми можно пользоваться">
                  <Input
                    value={debit}
                    onChange={(event) => setDebit(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Долг кредитки, ₽" hint="Положительным числом">
                    <Input
                      value={creditDebt}
                      onChange={(event) => setCreditDebt(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Лимит кредитки, ₽" hint="Не входит в свои деньги">
                    <Input
                      value={creditLimit}
                      onChange={(event) => setCreditLimit(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Мне должны, ₽" hint="Не входит в баланс">
                    <Input
                      value={owed}
                      onChange={(event) => setOwed(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Кто должен" hint="Необязательно">
                    <Input
                      value={counterparty}
                      onChange={(event) => setCounterparty(event.target.value)}
                      placeholder="Имя"
                    />
                  </Field>
                </div>
                <Field label="Месячный бюджет, ₽" hint="Сколько планируете тратить за месяц">
                  <Input
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    autoFocus
                  />
                </Field>
                <div className="grid grid-cols-[1fr_7rem] gap-2">
                  <Field label="Ожидаемый доход, ₽" hint="Например, зарплата">
                    <Input
                      value={income}
                      onChange={(event) => setIncome(event.target.value)}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </Field>
                  <Field label="День">
                    <Input
                      value={incomeDay}
                      onChange={(event) => setIncomeDay(event.target.value)}
                      inputMode="numeric"
                      placeholder="1–31"
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                {payments.length === 0 ? (
                  <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
                    Пока нет платежей. Добавьте аренду, подписки или платёж по кредитке.
                  </p>
                ) : null}
                {payments.map((payment, index) => (
                  <div key={index} className="grid grid-cols-[1fr_6.5rem_4.5rem_2.5rem] items-end gap-1.5">
                    <Field label={index === 0 ? 'Название' : ''}>
                      <Input
                        value={payment.name}
                        onChange={(event) => {
                          const nextPayments = [...payments];
                          nextPayments[index] = { ...payment, name: event.target.value };
                          setPayments(nextPayments);
                        }}
                        placeholder="Аренда"
                      />
                    </Field>
                    <Field label={index === 0 ? 'Сумма' : ''}>
                      <Input
                        value={payment.amount}
                        onChange={(event) => {
                          const nextPayments = [...payments];
                          nextPayments[index] = { ...payment, amount: event.target.value };
                          setPayments(nextPayments);
                        }}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </Field>
                    <Field label={index === 0 ? 'День' : ''}>
                      <Input
                        value={payment.day}
                        onChange={(event) => {
                          const nextPayments = [...payments];
                          nextPayments[index] = { ...payment, day: event.target.value };
                          setPayments(nextPayments);
                        }}
                        inputMode="numeric"
                        placeholder="5"
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Удалить платёж"
                      onClick={() => setPayments(payments.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPayments([...payments, { name: '', amount: '', day: '5' }])}
                >
                  <Plus className="h-4 w-4" /> Добавить платёж
                </Button>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              {step > 0 ? (
                <Button variant="outline" onClick={() => setStep(step - 1)} disabled={saving}>
                  <ArrowLeft className="h-4 w-4" /> Назад
                </Button>
              ) : null}
              {step < 2 ? (
                <Button className="flex-1" onClick={next}>
                  Далее <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button className="flex-1" onClick={() => void finish()} disabled={saving}>
                  <Check className="h-4 w-4" /> {saving ? 'Сохраняем…' : 'Начать учёт'}
                </Button>
              )}
            </div>

            <button
              type="button"
              className={cn(
                'w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline',
                step === 2 && 'hidden',
              )}
              onClick={() => setStep(2)}
            >
              Пропустить и заполнить позже
            </button>
          </CardContent>
        </Card>

        <div className="space-y-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <p>
            Финансовые данные сохраняются только в IndexedDB этого браузера. Они не отправляются на
            сервер и не входят в опубликованный код.
          </p>
          <p>
            На iPhone Safari и установленное на главный экран приложение могут иметь отдельные
            хранилища. Выберите одно из них и делайте резервные копии.
          </p>
        </div>
      </div>

      <ImportBackupDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
