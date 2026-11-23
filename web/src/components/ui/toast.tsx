import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils.ts';

export type ToastInput = {
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void | Promise<void> };
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId++;
      setItems((current) => [...current.slice(-2), { ...input, id }]);
      const timer = setTimeout(() => dismiss(id), input.duration ?? (input.action ? 8000 : 5000));
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex w-full max-w-lg flex-col gap-2 px-3 md:bottom-6">
          {items.map((item) => (
            <div
              key={item.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-xl',
                item.variant === 'error' && 'border-destructive/40',
                item.variant === 'success' && 'border-success/40',
              )}
            >
              <span className="mt-0.5 shrink-0">
                {item.variant === 'error' ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : item.variant === 'info' ? (
                  <Info className="h-5 w-5 text-primary" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                ) : null}
              </div>
              {item.action ? (
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-primary/10"
                  onClick={() => {
                    void item.action?.onClick();
                    dismiss(item.id);
                  }}
                >
                  {item.action.label === 'Отменить' ? <Undo2 className="h-4 w-4" /> : null}
                  {item.action.label}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Закрыть уведомление"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
                onClick={() => dismiss(item.id)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used within ToastProvider');
  return value;
}
