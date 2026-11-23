import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Info,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Monitor,
  DownloadCloud,
  History,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { BackupPanel } from '@/components/backup/backup-panel.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { SegmentedControl } from '@/components/ui/segmented.tsx';
import { cn } from '@/lib/utils.ts';
import { APP_VERSION } from '@/lib/appMeta.ts';
import { updateSettings } from '@/db/settings.ts';
import { clearFinancialData, db } from '@/db/db.ts';
import { ensureBaseData } from '@/db/defaults.ts';
import { loadDemoData } from '@/db/demo.ts';
import { formatDateTime } from '@/lib/dates.ts';
import type { Table } from 'dexie';
import type { AuditLog } from '@/domain/types.ts';

const AUDIT_LABEL: Record<string, string> = {
  'transaction.create': 'Создана операция',
  'transaction.update': 'Изменена операция',
  'transaction.delete': 'Удалена операция',
  'transaction.restore': 'Восстановлена операция',
  'account.create': 'Добавлен счёт',
  'account.update': 'Изменён счёт',
  'account.delete': 'Удалён счёт',
  'category.create': 'Добавлена категория',
  'category.update': 'Изменена категория',
  'goal.contribute': 'Отложено на цель',
  'goal.withdraw': 'Снято с цели',
  'backup.import': 'Импорт резервной копии',
  'demo.load': 'Загружены демо-данные',
  'onboarding.complete': 'Завершена настройка',
  'settings.update': 'Изменены настройки',
};

export function SettingsPage() {
  const { snapshot, settings } = useApp();
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [demoConfirmed, setDemoConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);

  const counts = useMemo(
    () => ({
      accounts: snapshot.accounts.length,
      transactions: snapshot.transactions.filter((transaction) => !transaction.deletedAt).length,
      deleted: snapshot.transactions.filter((transaction) => transaction.deletedAt).length,
      categories: snapshot.categories.length,
    }),
    [snapshot],
  );

  async function changeTheme(theme: 'system' | 'light' | 'dark') {
    try {
      await updateSettings(db, { theme });
    } catch (error) {
      toast({
        title: 'Не удалось сменить тему',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  }

  async function resetEverything() {
    if (confirmText !== 'УДАЛИТЬ' || busy) return;
    setBusy(true);
    try {
      await clearFinancialData(db);
      await ensureBaseData(db);
      setResetOpen(false);
      setConfirmText('');
      toast({
        title: 'Все данные удалены',
        description: 'Можно пройти настройку заново. Резервная копия не создавалась автоматически.',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: 'Не удалось удалить данные',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    if (!demoConfirmed || busy) return;
    setBusy(true);
    try {
      await loadDemoData(db);
      setDemoOpen(false);
      setDemoConfirmed(false);
      toast({
        title: 'Демо-данные загружены',
        description: 'Все суммы и имена вымышлены. Их можно удалить в любой момент.',
        variant: 'success',
        duration: 8000,
      });
    } catch (error) {
      toast({
        title: 'Не удалось загрузить демо',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadAudit() {
    const rows = await (db.audit as Table<AuditLog, string>).orderBy('at').reverse().limit(30).toArray();
    setAudit(rows);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Настройки</h1>
        <p className="text-sm text-muted-foreground">Локальные данные, резервные копии и тема.</p>
      </div>

      <BackupPanel />

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Monitor className="h-4 w-4 text-primary" /> Тема
          </h2>
          <SegmentedControl
            value={settings.theme}
            onChange={(theme) => void changeTheme(theme)}
            options={[
              { value: 'system', label: 'Системная', icon: <Monitor className="h-4 w-4" /> },
              { value: 'light', label: 'Светлая', icon: <Sun className="h-4 w-4" /> },
              { value: 'dark', label: 'Тёмная', icon: <Moon className="h-4 w-4" /> },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Тема — только оформление. Финансовые данные в localStorage не хранятся.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Database className="h-4 w-4 text-primary" /> Локальная база
          </h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Счета" value={counts.accounts} />
            <Stat label="Операции" value={counts.transactions} />
            <Stat label="Удалённые" value={counts.deleted} />
            <Stat label="Категории" value={counts.categories} />
          </div>
          <Field label="Счёт по умолчанию для быстрого ввода">
            <Select
              value={settings.defaultAccountId ?? ''}
              onChange={(event) =>
                void updateSettings(db, {
                  defaultAccountId: event.target.value || undefined,
                })
              }
            >
              <option value="">Не выбран</option>
              {snapshot.accounts
                .filter((account) => !account.archived)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">
            IndexedDB: {counts.transactions + counts.deleted} записей операций, включая удалённые для
            истории. Балансы пересчитываются из операций.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <History className="h-4 w-4 text-primary" /> История изменений
          </h2>
          <p className="text-xs text-muted-foreground">
            Журнал действий хранится локально и помогает восстановить ход событий.
          </p>
          {audit === null ? (
            <Button variant="outline" size="sm" onClick={() => void loadAudit()}>
              Показать последние 30
            </Button>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">Записей пока нет.</p>
              ) : (
                audit.map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-muted/50 px-3 py-2 text-xs">
                    <p className="font-medium">
                      {AUDIT_LABEL[entry.action] ?? entry.action}
                      {entry.entity ? (
                        <span className="ml-1 font-normal text-muted-foreground">
                          ({entry.entity})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground">{formatDateTime(entry.at)}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Smartphone className="h-4 w-4 text-primary" /> Установка на iPhone
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Откройте сайт в Safari (не в другом браузере).</li>
            <li>Нажмите «Поделиться» → «На экран Домой».</li>
            <li>Запускайте приложение с иконки — тогда работает офлайн-режим.</li>
            <li>Сделайте резервную копию и сохраните файл в «Файлы» или iCloud Drive.</li>
          </ol>
          <div className="rounded-xl bg-warning/15 p-3 text-xs text-muted-foreground">
            Safari и установленное PWA на iOS могут использовать разные хранилища. Данные не
            синхронизируются между ними. Выберите одно приложение и не переключайтесь без экспорта.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <DownloadCloud className="h-4 w-4 text-primary" /> Демо и опасные действия
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDemoOpen(true)}>
              Загрузить демо-данные
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setResetOpen(true)}>
              <Trash2 className="h-4 w-4" /> Удалить все данные
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Демо-данные вымышлены и заменяют текущую базу. Удаление очищает IndexedDB; файлы
            резервных копий на диске не затрагиваются.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Мои финансы · версия {APP_VERSION}</p>
            <p>
              Работает без сервера, аккаунта и платных API. Все записи хранятся в IndexedDB
              браузера. Синхронизации между устройствами нет. Резервная копия создаётся вручную;
              приложение не называет её автоматической.
            </p>
            <p className="mt-2">
              Перед публикацией данные не попадают в сборку: в коде только стандартные категории и
              вымышленные демо-суммы.
            </p>
            <Badge variant="outline" className="mt-2">
              GitHub Pages · HTTPS · офлайн после первой загрузки
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={demoOpen}
        onClose={() => {
          setDemoOpen(false);
          setDemoConfirmed(false);
        }}
        title="Загрузить демо-данные?"
        description="Это вымышленные счета и операции для знакомства с интерфейсом."
        footer={
          <Button className="h-11 w-full" onClick={() => void loadDemo()} disabled={busy || !demoConfirmed}>
            {busy ? 'Загружаем…' : 'Заменить базу демо-данными'}
          </Button>
        }
      >
        <label className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          <input
            type="checkbox"
            checked={demoConfirmed}
            onChange={(event) => setDemoConfirmed(event.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            <span className="block font-medium">Текущие данные будут удалены</span>
            <span className="block text-xs text-muted-foreground">
              Сначала импортируйте или скачайте копию, если она нужна.
            </span>
          </span>
        </label>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setConfirmText('');
        }}
        title="Удалить все данные?"
        description="Это необратимо очистит IndexedDB. Резервные копии на диске останутся."
        footer={
          <Button
            variant="destructive"
            className="h-11 w-full"
            onClick={() => void resetEverything()}
            disabled={busy || confirmText !== 'УДАЛИТЬ'}
          >
            {busy ? 'Удаляем…' : 'Удалить всё'}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p>
              Счета, операции, долги, цели и настройки будут удалены. Восстановить их можно только
              из резервной копии.
            </p>
          </div>
          <Field label="Введите УДАЛИТЬ для подтверждения">
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="УДАЛИТЬ"
              autoFocus
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('text-lg font-semibold tabular')}>{value}</p>
    </div>
  );
}
