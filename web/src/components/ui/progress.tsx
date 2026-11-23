import { cn } from '@/lib/utils.ts';

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  value: number;
  className?: string;
  indicatorClassName?: string;
}) {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bounded)}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width]', indicatorClassName)}
        style={{ width: `${bounded}%` }}
      />
    </div>
  );
}
