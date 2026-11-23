import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Coins,
  Goal,
  Home,
  List,
  Plus,
  Settings,
  Target,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils.ts';
import { useApp } from '@/state/app-context.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QuickAddSheet } from '@/components/quick-add-sheet.tsx';

const NAV_ITEMS = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/transactions', label: 'Операции', icon: List },
  { to: '/budget', label: 'Бюджет', icon: BarChart3 },
  { to: '/accounts', label: 'Счета', icon: Wallet },
  { to: '/debts', label: 'Долги', icon: Coins },
  { to: '/goals', label: 'Цели', icon: Target },
  { to: '/settings', label: 'Настройки', icon: Settings },
];

const MOBILE_NAV = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/transactions', label: 'Операции', icon: List },
  { to: '/accounts', label: 'Счета', icon: Wallet },
  { to: '/budget', label: 'Бюджет', icon: BarChart3 },
];

export function AppShell() {
  const { openQuickAdd } = useApp();

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-card/70 px-3 py-5 backdrop-blur md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Goal className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Мои финансы</p>
            <p className="text-[11px] text-muted-foreground">только на этом устройстве</p>
          </div>
        </div>

        <Button className="mb-4 w-full" onClick={() => openQuickAdd('expense')}>
          <Plus className="h-4 w-4" /> Добавить операцию
        </Button>

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-xl bg-muted/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
          Данные не отправляются на сервер. Делайте резервные копии в настройках.
        </div>
      </aside>

      <header className="pt-safe sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Goal className="h-4 w-4" />
            </div>
            <span className="text-base font-semibold">Мои финансы</span>
          </div>
          <NavLink
            to="/settings"
            aria-label="Настройки"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
          >
            <Settings className="h-5 w-5" />
          </NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-3 pb-28 pt-4 md:ml-60 md:max-w-[calc(100%-15rem)] md:px-8 md:pb-12 md:pt-8">
        <Outlet />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden">
        <div className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-5 items-center px-1">
          {MOBILE_NAV.slice(0, 2).map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label="Добавить операцию"
              onClick={() => openQuickAdd('expense')}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95"
            >
              <Plus className="h-7 w-7" />
            </button>
          </div>
          {MOBILE_NAV.slice(2).map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
      </nav>

      <QuickAddSheet />
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
          isActive ? 'text-primary' : 'text-muted-foreground',
        )
      }
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}
