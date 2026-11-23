import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'default',
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
  size?: 'default' | 'sm';
}) {
  return (
    <div
      className={cn(
        'no-scrollbar flex w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1',
        className,
      )}
      role="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
