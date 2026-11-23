import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db.ts';
import type { FinanceSnapshot } from '@/domain/finance.ts';
import { settingsDefaults } from '@/domain/finance.ts';
import type { AppSettings, Transaction, TransactionKind } from '@/domain/types.ts';

type QuickAddState = {
  open: boolean;
  kind: TransactionKind;
  editing?: Transaction;
};

type LoadResult =
  | { ok: true; snapshot: FinanceSnapshot }
  | { ok: false; error: string };

type AppContextValue = {
  snapshot: FinanceSnapshot;
  settings: AppSettings;
  loading: boolean;
  error: string | null;
  quickAdd: QuickAddState;
  openQuickAdd: (kind?: TransactionKind, editing?: Transaction) => void;
  closeQuickAdd: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const result = useLiveQuery<LoadResult>(async () => {
    try {
      const [
        accounts,
        categories,
        transactions,
        entries,
        debts,
        goals,
        plannedPayments,
        plannedInflows,
        budgets,
        settingsRows,
      ] = await Promise.all([
        db.accounts.toArray(),
        db.categories.toArray(),
        db.transactions.toArray(),
        db.entries.toArray(),
        db.debts.toArray(),
        db.goals.toArray(),
        db.plannedPayments.toArray(),
        db.plannedInflows.toArray(),
        db.budgets.toArray(),
        db.settings.toArray(),
      ]);
      return {
        ok: true,
        snapshot: {
          accounts,
          categories,
          transactions,
          entries,
          debts,
          goals,
          plannedPayments,
          plannedInflows,
          budgets,
          settings: settingsRows[0] ?? settingsDefaults(),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Не удалось открыть локальную базу',
      };
    }
  }, []);

  const [quickAdd, setQuickAdd] = useState<QuickAddState>({ open: false, kind: 'expense' });

  const openQuickAdd = useCallback((kind: TransactionKind = 'expense', editing?: Transaction) => {
    setQuickAdd({ open: true, kind: editing?.kind ?? kind, editing });
  }, []);
  const closeQuickAdd = useCallback(() => setQuickAdd((state) => ({ ...state, open: false })), []);

  const settings = useMemo(
    () => (result?.ok ? result.snapshot.settings : settingsDefaults()),
    [result],
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      try {
        localStorage.setItem('pf-theme', settings.theme);
      } catch {
        // UI preference only; ignore storage restrictions.
      }
    };
    apply();
    if (settings.theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [settings.theme]);

  const value = useMemo<AppContextValue>(
    () => ({
      snapshot: result?.ok ? result.snapshot : emptySnapshot(settings),
      settings,
      loading: result === undefined,
      error: result && !result.ok ? result.error : null,
      quickAdd,
      openQuickAdd,
      closeQuickAdd,
    }),
    [result, settings, quickAdd, openQuickAdd, closeQuickAdd],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function emptySnapshot(settings: AppSettings): FinanceSnapshot {
  return {
    accounts: [],
    categories: [],
    transactions: [],
    entries: [],
    debts: [],
    goals: [],
    plannedPayments: [],
    plannedInflows: [],
    budgets: [],
    settings,
  };
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used within AppProvider');
  return value;
}
