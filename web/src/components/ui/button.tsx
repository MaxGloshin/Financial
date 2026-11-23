import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
type Size = 'default' | 'sm' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-card hover:bg-muted text-foreground',
  ghost: 'hover:bg-muted text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  success: 'bg-success text-white hover:opacity-90',
};

const sizes: Record<Size, string> = {
  default: 'h-11 px-4 py-2',
  sm: 'h-9 px-3 text-sm',
  lg: 'h-13 px-6 text-base',
  icon: 'h-11 w-11',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
};

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
