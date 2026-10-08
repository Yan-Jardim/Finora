import {
  Baby,
  Banknote,
  Book,
  Briefcase,
  Bus,
  Car,
  Coffee,
  CreditCard,
  Droplet,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  MoreHorizontal,
  Music,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Repeat,
  Shirt,
  ShoppingCart,
  Smartphone,
  Tv,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Ícones são guardados como string no banco; este registro os resolve em componentes. */
export const ICONS: Record<string, LucideIcon> = {
  baby: Baby,
  banknote: Banknote,
  book: Book,
  briefcase: Briefcase,
  bus: Bus,
  car: Car,
  coffee: Coffee,
  "credit-card": CreditCard,
  droplet: Droplet,
  dumbbell: Dumbbell,
  fuel: Fuel,
  gamepad: Gamepad2,
  gift: Gift,
  "graduation-cap": GraduationCap,
  "heart-pulse": HeartPulse,
  home: Home,
  landmark: Landmark,
  more: MoreHorizontal,
  music: Music,
  "paw-print": PawPrint,
  "piggy-bank": PiggyBank,
  pill: Pill,
  plane: Plane,
  repeat: Repeat,
  shirt: Shirt,
  "shopping-cart": ShoppingCart,
  smartphone: Smartphone,
  tv: Tv,
  "trending-up": TrendingUp,
  users: Users,
  utensils: Utensils,
  wallet: Wallet,
  wifi: Wifi,
  wrench: Wrench,
  zap: Zap,
};

export const ICON_NAMES = Object.keys(ICONS);

export function CategoryIcon({
  name,
  color = "#71717a",
  className,
}: {
  name?: string;
  color?: string;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || MoreHorizontal;
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${className ?? ""}`}
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
