import { useMemo, useState } from 'react';
import { CalendarDays, Pencil, PiggyBank, Plus, Target, Trash2, TrendingUp } from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { goalProgress } from '@/domain/finance.ts';
import type { Goal } from '@/domain/types.ts';
import {
  contributeToGoal,
  createGoal,
  deleteGoal,
  updateGoal,
} from '@/db/planning.ts';
import { db } from '@/db/db.ts';
import { formatDate } from '@/lib/dates.ts';
import { formatMoney, formatMoneyInput, parseMoneyToMinor } from '@/lib/money.ts';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';

export function GoalsPage() {
  const { snapshot } = useApp();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState({
    name: '',
    target: '',
    saved: '',
    deadline: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [contributeGoal, setContributeGoal] = useState<Goal | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');
  const [contributeDirection, setContributeDirection] = useState<'add' | 'withdraw'>('add');
  const [contributeSaving, setContributeSaving] = useState(false);
  const [contributeError, setContributeError] = useState<string | null>(null);

  const goals = useMemo(
    () =>
      snapshot.goals
        .filter((goal) => !goal.deletedAt)
        .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')),
    [snapshot.goals],
  );
  const saved = goals.reduce((total, goal) => total + goal.savedMinor, 0);
  const target = goals.reduce((total, goal) => total + goal.targetMinor, 0);

  function startCreate() {
    setEditing(null);
    setForm({ name: '', target: '', saved: '', deadline: '', note: '' });
    setError(null);
    setConfirmDelete(false);
    setOpen(true);
  }

  function startEdit(goal: Goal) {
    setEditing(goal);
    setForm({
      name: goal.name,
      target: formatMoneyInput(goal.targetMinor),
      saved: formatMoneyInput(goal.savedMinor),
      deadline: goal.deadline ?? '',
      note: goal.note ?? '',
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
      const input = {
        name: form.name,
        targetMinor: parseMoneyToMinor(form.target),
        savedMinor: form.saved === '' ? 0 : parseMoneyToMinor(form.saved),
        deadline: form.deadline || null,
        note: form.note,
      };
      if (editing) {
        await updateGoal(db, editing.id, input);
        toast({ title: 'Цель обновлена', variant: 'success' });
      } else {
        await createGoal(db, input);
        toast({ title: 'Цель добавлена', variant: 'success' });
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить цель');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    try {
      await deleteGoal(db, editing.id);
      toast({ title: 'Цель удалена', variant: 'success' });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить цель');
    } finally {
      setSaving(false);
    }
  }

  function startContribute(goal: Goal, direction: 'add' | 'withdraw') {
    setContributeGoal(goal);
    setContributeDirection(direction);
    setContributeAmount('');
    setContributeError(null);
  }

  async function contribute() {
    if (!contributeGoal || contributeSaving) return;
    setContributeSaving(true);
    setContributeError(null);
    try {
      const amount = parseMoneyToMinor(contributeAmount);
      const delta = contributeDirection === 'add' ? amount : -amount;
      await contributeToGoal(db, contributeGoal.id, delta);
      toast({
        title: contributeDirection === 'add' ? 'Отложено' : 'Снято с цели',
        description: formatMoney(Math.abs(delta)),
        variant: 'success',
      });
      setContributeGoal(null);
    } catch (caught) {
      setContributeError(caught instanceof Error ? caught.message : 'Не удалось изменить цель');
    } finally {
      setContributeSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Цели</h1>
          <p className="text-sm text-muted-foreground">
            План накоплений. Деньги остаются на ваших счетах и не списываются.
          </p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Цель</span>
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Отложено по целям</p>
            <p className="mt-1 text-2xl font-semibold tabular">{formatMoney(saved)}</p>
            <p className="text-xs text-muted-foreground">из {formatMoney(target)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Общий прогресс</p>
            <p className="mt-1 text-2xl font-semibold tabular">
              {target > 0 ? Math.round((saved / target) * 100) : 0}%
            </p>
            <Progress value={target > 0 ? (saved / target) * 100 : 0} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Target className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Целей пока нет</p>
            <p className="text-sm text-muted-foreground">
              Добавьте цель — отпуск, подушку безопасности или крупную покупку.
            </p>
            <Button className="mt-2" onClick={startCreate}>
              <Plus className="h-4 w-4" /> Добавить цель
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {goals.map((goal) => {
            const progress = goalProgress(goal);
            return (
              <Card key={goal.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                        style={goal.color ? { backgroundColor: `${goal.color}20`, color: goal.color } : undefined}
                      >
                        <PiggyBank className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{goal.name}</p>
                        {goal.deadline ? (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" /> до {formatDate(goal.deadline, true)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Изменить цель"
                      onClick={() => startEdit(goal)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <p className="text-2xl font-semibold tabular">{formatMoney(goal.savedMinor)}</p>
                    <Badge variant={progress >= 100 ? 'success' : 'outline'}>
                      {Math.round(progress)}%
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Цель {formatMoney(goal.targetMinor)} · осталось{' '}
                    {formatMoney(Math.max(0, goal.targetMinor - goal.savedMinor))}
                  </p>
                  <Progress value={progress} className="mt-2" />
                  {goal.note ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{goal.note}</p>
                  ) : null}
                  <div className="mt-3 flex gap-1.5">
                    <Button size="sm" className="flex-1" onClick={() => startContribute(goal, 'add')}>
                      <Plus className="h-3.5 w-3.5" /> Отложить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => startContribute(goal, 'withdraw')}
                    >
                      Снять
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Цель — это планирование. Отложенная сумма не переводится на отдельный счёт и не уменьшает
        доступный бюджет автоматически.
      </p>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Изменить цель' : 'Новая цель'}
        footer={
          <div className="flex gap-2">
            <Button className="h-11 flex-1" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
            {editing ? (
              <Button
                variant="outline"
                className="text-destructive"
                aria-label="Удалить цель"
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
              <p className="text-sm font-medium">Удалить цель?</p>
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
              placeholder="Отпуск"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Цель, ₽">
              <Input
                value={form.target}
                onChange={(event) => setForm({ ...form, target: event.target.value })}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            <Field label="Уже отложено">
              <Input
                value={form.saved}
                onChange={(event) => setForm({ ...form, saved: event.target.value })}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
          </div>
          <Field label="Дата цели" hint="Необязательно">
            <Input
              type="date"
              value={form.deadline}
              onChange={(event) => setForm({ ...form, deadline: event.target.value })}
            />
          </Field>
          <Field label="Заметка" hint="Необязательно">
            <Textarea
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              rows={2}
            />
          </Field>
          {error ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={contributeGoal !== null}
        onClose={() => setContributeGoal(null)}
        title={contributeDirection === 'add' ? 'Отложить на цель' : 'Снять с цели'}
        description={contributeGoal?.name}
        footer={
          <Button className="h-11 w-full" onClick={() => void contribute()} disabled={contributeSaving}>
            {contributeSaving ? 'Сохраняем…' : 'Готово'}
          </Button>
        }
      >
        <div className="space-y-3">
          <Field
            label="Сумма"
            hint={
              contributeGoal
                ? `Уже отложено ${formatMoney(contributeGoal.savedMinor)} из ${formatMoney(
                    contributeGoal.targetMinor,
                  )}`
                : undefined
            }
          >
            <Input
              value={contributeAmount}
              onChange={(event) => setContributeAmount(event.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0"
            />
          </Field>
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            Операция по счёту не создаётся. Это только план.
          </div>
          {contributeError ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {contributeError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
