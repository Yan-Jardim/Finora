import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

/** Sidebar fixa (desktop). No mobile o mesmo conteúdo abre em drawer (MobileNav). */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 overflow-y-auto border-r border-border bg-card px-3 py-5 lg:flex">
      <Brand />
      <SidebarNav />
    </aside>
  );
}
