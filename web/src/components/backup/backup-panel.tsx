import { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileJson,
  KeyRound,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useApp } from '@/state/app-context.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog } from '@/components/ui/dialog.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import {
  backupFilename,
  backupStatus,
  encryptBackup,
  exportBackup,
  serializeBackup,
} from '@/db/backup.ts';
import { markBackupDone } from '@/db/settings.ts';
import { db } from '@/db/db.ts';
import { downloadTextFile } from '@/lib/download.ts';
import { formatDateTime } from '@/lib/dates.ts';
import { ImportBackupDialog } from './import-dialog.tsx';

export function BackupPanel() {
  const { settings } = useApp();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const status = backupStatus(settings);

  async function downloadPlain() {
    if (busy) return;
    setBusy(true);
    try {
      const file = await exportBackup(db);
      downloadTextFile(backupFilename(false), serializeBackup(file));
      await markBackupDone(db, file.formatVersion);
      toast({
        title: 'Резервная копия скачана',
        description: 'Проверьте, что файл сохранился в «Файлы» или «Загрузки».',
        variant: 'success',
        duration: 7000,
      });
    } catch (caught) {
      toast({
        title: 'Не удалось создать копию',
        description: caught instanceof Error ? caught.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function downloadEncrypted() {
    if (busy) return;
    if (password.length < 8) {
      toast({ title: 'Пароль должен быть не короче 8 символов', variant: 'error' });
      return;
    }
    if (password !== passwordRepeat) {
      toast({ title: 'Пароли не совпадают', variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      const file = await exportBackup(db);
      const envelope = await encryptBackup(file, password);
      downloadTextFile(backupFilename(true), JSON.stringify(envelope, null, 2));
      await markBackupDone(db, file.formatVersion);
      setPassword('');
      setPasswordRepeat('');
      setPasswordOpen(false);
      toast({
        title: 'Зашифрованная копия скачана',
        description: 'Пароль не сохранён. Без него файл не восстановить.',
        variant: 'success',
        duration: 8000,
      });
    } catch (caught) {
      toast({
        title: 'Не удалось создать копию',
        description: caught instanceof Error ? caught.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Резервная копия</h2>
                <Badge variant={status.needsWarning ? 'warning' : 'success'}>
                  {status.needsWarning ? 'нужна копия' : 'актуальна'}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {status.lastBackupAt
                  ? `${status.label} · ${formatDateTime(status.lastBackupAt)}`
                  : status.label}
              </p>
            </div>
          </div>

          {status.needsWarning ? (
            <div className="flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Данные хранятся только в IndexedDB браузера. Очистка данных сайта, удаление
                приложения или сбой устройства могут их уничтожить. Копия — вручную, автоматически
                браузер её не сохраняет.
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void downloadPlain()} disabled={busy}>
              <Download className="h-4 w-4" /> Скачать JSON
            </Button>
            <Button variant="outline" onClick={() => setPasswordOpen(true)} disabled={busy}>
              <KeyRound className="h-4 w-4" /> С паролем
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} disabled={busy}>
              <Upload className="h-4 w-4" /> Импорт
            </Button>
          </div>

          <div className="rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <FileJson className="h-3.5 w-3.5" /> Как сохранить на iPhone
            </p>
            <p className="mt-1">
              Нажмите «Скачать JSON», затем в Safari выберите «Сохранить в Файлы». Копия должна
              лежать в iCloud Drive или другом месте вне хранилища Safari. Импорт — через кнопку
              «Импорт».
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={passwordOpen}
        onClose={() => {
          setPasswordOpen(false);
          setPassword('');
          setPasswordRepeat('');
        }}
        title="Зашифрованная резервная копия"
        description="AES-GCM + PBKDF2 через Web Crypto. Пароль нигде не сохраняется."
        footer={
          <Button className="h-11 w-full" onClick={() => void downloadEncrypted()} disabled={busy}>
            {busy ? 'Шифруем…' : 'Скачать зашифрованную копию'}
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Пароль" hint="Минимум 8 символов. Запишите его отдельно.">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              autoComplete="new-password"
            />
          </Field>
          <Field label="Повторите пароль">
            <Input
              type="password"
              value={passwordRepeat}
              onChange={(event) => setPasswordRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Если пароль забыт, восстановить копию невозможно. Пароль не отправляется на сервер,
            потому что сервера нет.
          </p>
        </div>
      </Dialog>

      <ImportBackupDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
