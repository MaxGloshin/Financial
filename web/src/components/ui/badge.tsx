import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils.ts';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border text-muted-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-foreground',
  destructive: 'bg-destructive/10 text-destructive',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
