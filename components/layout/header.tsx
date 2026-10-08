import { Bell, Search } from "lucide-react";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

export function Header({ user }: { user: { name: string; email: string; householdName: string } }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
      <MobileNav />

      {/* Pesquisa global: apenas visual por enquanto. */}
      <div className="relative hidden max-w-md flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          disabled
          placeholder="Pesquisar contas, cartões, movimentações… (em breve)"
          aria-label="Pesquisa global"
          className="h-9 w-full cursor-not-allowed rounded-lg border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground/70"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" aria-label="Notificações" className="rounded-lg p-2 text-muted-foreground hover:bg-muted">
          <Bell className="size-5" />
        </button>
        <UserMenu name={user.name} email={user.email} householdName={user.householdName} />
      </div>
    </header>
  );
}
