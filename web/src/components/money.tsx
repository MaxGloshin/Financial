import { formatMoney } from '@/lib/money.ts';
import { cn } from '@/lib/utils.ts';

export function Money({
  minor,
  className,
  plus = false,
  tone = 'default',
  alwaysKopecks = false,
}: {
  minor: number;
  className?: string;
  plus?: boolean;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  alwaysKopecks?: boolean;
}) {
  return (
    <span
      className={cn(
        'tabular',
        tone === 'positive' && 'text-success',
        tone === 'negative' && 'text-destructive',
        tone === 'muted' && 'text-muted-foreground',
        className,
      )}
    >
      {formatMoney(minor, { plus, alwaysKopecks })}
    </span>
  );
}
