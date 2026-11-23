import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';

export function UpdatePrompt() {
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      window.setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
    onRegisterError(error) {
      console.warn('Service worker registration failed', error);
    },
  });

  useEffect(() => {
    if (offlineReady) {
      toast({
        title: 'Приложение готово к работе офлайн',
        description: 'После первой загрузки интерфейс открывается без интернета. Данные — локально.',
        variant: 'success',
      });
      setOfflineReady(false);
    }
  }, [offlineReady, setOfflineReady, toast]);

  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[65] mx-auto max-w-md rounded-2xl border border-primary/30 bg-card p-3 shadow-xl md:bottom-6">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <WifiOff className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Доступна новая версия</p>
          <p className="text-xs text-muted-foreground">
            Операции и счета в IndexedDB сохранятся. Обновление заменит только файлы интерфейса.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void updateServiceWorker(true);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Обновить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                setNeedRefresh(false);
              }}
            >
              Позже
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
