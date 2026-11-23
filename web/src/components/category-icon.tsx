import {
  ArrowLeftRight,
  Banknote,
  Bus,
  Car,
  CircleEllipsis,
  CirclePlus,
  Clapperboard,
  Coffee,
  CreditCard,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  Landmark,
  PawPrint,
  PiggyBank,
  Receipt,
  Repeat,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Tag,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils.ts';

const icons: Record<string, LucideIcon> = {
  'shopping-basket': ShoppingBasket,
  home: House,
  bus: Bus,
  car: Car,
  utensils: UtensilsCrossed,
  coffee: Coffee,
  'heart-pulse': HeartPulse,
  smartphone: Smartphone,
  clapperboard: Clapperboard,
  shirt: Shirt,
  repeat: Repeat,
  'graduation-cap': GraduationCap,
  'paw-print': PawPrint,
  'circle-ellipsis': CircleEllipsis,
  wallet: Wallet,
  laptop: Laptop,
  gift: Gift,
  'piggy-bank': PiggyBank,
  'circle-plus': CirclePlus,
  banknote: Banknote,
  'credit-card': CreditCard,
  'arrow-left-right': ArrowLeftRight,
  receipt: Receipt,
  landmark: Landmark,
  tag: Tag,
};

export function CategoryIcon({
  name,
  className,
  color,
}: {
  name: string;
  className?: string;
  color?: string;
}) {
  const Icon = icons[name] ?? Tag;
  return (
    <span
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted',
        className,
      )}
      style={color ? { backgroundColor: `${color}20`, color } : undefined}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

export const CATEGORY_ICON_OPTIONS = Object.keys(icons);
