import {
  BarChart3,
  CalendarDays,
  CreditCard,
  FolderTree,
  Landmark,
  LayoutDashboard,
  LineChart,
  ListChecks,
  PiggyBank,
  Receipt,
  Repeat,
  Settings,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Itens fora do MVP aparecem desabilitados. */
  soon?: boolean;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    items: [
      { label: "Visão Geral", href: "/", icon: LayoutDashboard },
      { label: "Contas do mês", href: "/contas-do-mes", icon: ListChecks },
      { label: "Movimentações", href: "/movimentacoes", icon: Receipt },
      { label: "Calendário", href: "/calendario", icon: CalendarDays },
      { label: "Recorrências", href: "/recorrencias", icon: Repeat },
      { label: "Contas", href: "/contas", icon: Landmark },
      { label: "Cartões", href: "/cartoes", icon: CreditCard },
      { label: "Dívidas", href: "/dividas", icon: Wallet },
    ],
  },
  {
    title: "Futuro",
    items: [
      { label: "Planejamento", href: "/planejamento", icon: LineChart },
      { label: "Objetivos", href: "/objetivos", icon: Target },
      { label: "Cofrinhos", href: "/cofrinhos", icon: PiggyBank },
      { label: "Relatórios", href: "/relatorios", icon: BarChart3 },
    ],
  },
  {
    title: "Cadastros",
    items: [
      { label: "Categorias", href: "/categorias", icon: FolderTree },
      { label: "Pessoas", href: "/pessoas", icon: Users },
      { label: "Configurações", href: "/configuracoes", icon: Settings },
    ],
  },
];
