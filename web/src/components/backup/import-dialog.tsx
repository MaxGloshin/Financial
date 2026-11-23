import { useRef, useState } from 'react';
import { AlertTriangle, FileJson, KeyRound, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input, Field } from '@/components/ui/input.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import {
  importBackup,
  parseBackupJson,
  readBackup,
  type BackupFile,
  type ImportMode,
} from '@/db/backup.ts';
import { db } from '@/db/db.ts';
import { formatDateTime } from '@/lib/dates.ts';

export function ImportBackupDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<BackupFile | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  function reset() {
    setText(null);
    setEncrypted(false);
    setPassword('');
    setFile(null);
    setMode('merge');
    setReplaceConfirmed(false);
    setError(null);
    setBusy(false);
    setWarnings([]);
    if (fileInput.current) fileInput.current.value = '';
  }

  function close() {
    reset();
    onClose();
  }

  async function onFileChange(selected: File | undefined) {
    if (!selected) return;
    setError(null);
    setFile(null);
    setWarnings([]);
    setReplaceConfirmed(false);
    try {
      const content = await selected.text();
      setText(content);
      const parsed = parseBackupJson(content);
      if (parsed.kind === 'encrypted') {
        setEncrypted(true);
        setPassword('');
        return;
      }
      setEncrypted(false);
      const loaded = await readBackup(content);
      setFile(loaded.file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось прочитать файл');
      setText(null);
    }
  }

  async function unlock() {
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await readBackup(text, password);
      setFile(loaded.file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось расшифровать файл');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    if (mode === 'replace' && !replaceConfirmed) {
      setError('Подтвердите, что текущие данные будут заменены');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await importBackup(db, file, mode);
      const added = Object.values(result.added).reduce((total, value) => total + value, 0);
      setWarnings(result.warnings);
      toast({
        title: mode === 'replace' ? 'Данные восстановлены' : 'Импорт завершён',
        description: `Добавлено записей: ${added}. Проверьте балансы и сделайте новую копию.`,
        variant: 'success',
        duration: 8000,
      });
      onImported?.();
      if (result.warnings.length === 0) close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось импортировать копию');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Импорт резервной копии"
      description="Файл читается локально. Ничего не отправляется в интернет."
      footer={
        file ? (
          <Button className="h-11 w-full" onClick={() => void runImport()} disabled={busy}>
            {busy ? 'Восстанавливаем…' : mode === 'replace' ? 'Заменить все данные' : 'Добавить новые записи'}
          </Button>
        ) : encrypted && text ? (
          <Button className="h-11 w-full" onClick={() => void unlock()} disabled={busy || !password}>
            {busy ? 'Проверяем…' : 'Расшифровать'}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-border p-4 text-center">
          <FileJson className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Выберите JSON-файл копии</p>
          <p className="text-xs text-muted-foreground">
            Поддерживаются обычные и зашифрованные копии этого приложения.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void onFileChange(event.target.files?.[0])}
          />
          <Button variant="outline" className="mt-3" onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4" /> Выбрать файл
          </Button>
        </div>

        {encrypted && !file ? (
          <Field
            label="Пароль от копии"
            hint="Пароль не сохраняется. Если забыли — файл восстановить нельзя."
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pl-9"
                placeholder="Введите пароль"
                autoFocus
              />
            </div>
          </Field>
        ) : null}

        {file ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-muted/60 p-3 text-sm">
              <p className="font-medium">Копия от {formatDateTime(file.exportedAt)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Версия формата {file.formatVersion} · приложение {file.appVersion}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                <span>Счета: {file.counts.accounts}</span>
                <span>Операции: {file.counts.transactions}</span>
                <span>Категории: {file.counts.categories}</span>
                <span>Долги: {file.counts.debts}</span>
                <span>Цели: {file.counts.goals}</span>
                <span>Платежи: {file.counts.plannedPayments}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">Добавить недостающие записи</span>
                  <span className="block text-xs text-muted-foreground">
                    Существующие ID и операции с теми же ключами будут пропущены.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3 text-sm">
                <input
                  type="radio"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">Заменить всё текущее содержимое</span>
                  <span className="block text-xs text-muted-foreground">
                    Текущие счета, операции и настройки будут удалены.
                  </span>
                </span>
              </label>
            </div>

            {mode === 'replace' ? (
              <label className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                  className="mt-0.5 accent-[var(--destructive)]"
                />
                <span>
                  <span className="flex items-center gap-1 font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Заменить все данные?
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Сначала скачайте копию текущей базы, если она нужна.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="rounded-xl bg-warning/15 p-3 text-sm">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <Button variant="outline" size="sm" className="mt-2" onClick={close}>
              Закрыть
            </Button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
