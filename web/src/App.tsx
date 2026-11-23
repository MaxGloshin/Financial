import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from '@/state/app-context.tsx';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { AppShell } from '@/components/layout/app-shell.tsx';
import { DashboardPage } from '@/pages/dashboard.tsx';
import { TransactionsPage } from '@/pages/transactions.tsx';
import { AccountsPage } from '@/pages/accounts.tsx';
import { DebtsPage } from '@/pages/debts.tsx';
import { BudgetPage } from '@/pages/budget.tsx';
import { GoalsPage } from '@/pages/goals.tsx';
import { SettingsPage } from '@/pages/settings.tsx';
import { OnboardingPage } from '@/pages/onboarding.tsx';
import { UpdatePrompt } from '@/components/update-prompt.tsx';
import { Button } from '@/components/ui/button.tsx';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  return null;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Открываем локальную базу…</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-card p-5 text-center">
        <h1 className="text-lg font-semibold">Не удалось открыть локальную базу</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          IndexedDB может быть недоступен в приватном режиме или при запрете хранения данных.
          Откройте сайт в обычном окне браузера.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Перезагрузить
        </Button>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { loading, error, settings } = useApp();

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!settings.onboardingComplete) return <OnboardingPage />;

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="debts" element={<DebtsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <h1 className="text-lg font-semibold">Страница не найдена</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Вернитесь на главный экран.
                </p>
                <Button className="mt-4" onClick={() => (window.location.hash = '#/')}>
                  На главную
                </Button>
              </div>
            }
          />
        </Route>
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <ToastProvider>
          <AppRoutes />
          {/* Registered even before onboarding: offline work must not depend on it. */}
          <UpdatePrompt />
        </ToastProvider>
      </AppProvider>
    </HashRouter>
  );
}
