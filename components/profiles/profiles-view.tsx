"use client";

import { Pencil, Plus, Power, Users } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { FinancialProfile } from "@/domain/types";
import { cn } from "@/lib/utils";
import { ProfileFormDialog } from "./profile-form";

export function ProfilesView() {
  const { data, ready, repos } = useWorkspace();
  const run = useAction();
  const [editing, setEditing] = useState<FinancialProfile | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  if (!ready) return <PageSkeleton />;

  const openForm = (profile?: FinancialProfile) => {
    setEditing(profile);
    setFormOpen(true);
  };

  const toggle = (profile: FinancialProfile) =>
    run(
      () => repos.profiles.update(profile.id, { active: !profile.active }),
      profile.active ? `${profile.name} foi desativado(a).` : `${profile.name} foi reativado(a).`,
    );

  const newButton = (
    <Button onClick={() => openForm()}>
      <Plus className="size-4" aria-hidden /> Nova pessoa
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pessoas"
        description="Perfis financeiros: cada pessoa e o casal têm suas próprias contas, cartões e gastos."
        action={data.profiles.length > 0 ? newButton : undefined}
      />

      {data.profiles.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Nenhuma pessoa cadastrada"
            description="Cadastre a primeira pessoa (e o casal, se for o caso) para começar a organizar suas finanças."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.profiles.map((profile) => {
            const accounts = data.accounts.filter((a) => a.ownerProfileId === profile.id).length;
            const cards = data.creditCards.filter((c) => c.ownerProfileId === profile.id).length;
            return (
              <li key={profile.id}>
                <Card className={cn("flex h-full flex-col gap-4", !profile.active && "opacity-70")}>
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
                      style={{ backgroundColor: profile.color }}
                      aria-hidden
                    >
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{profile.name}</p>
                      <div className="mt-1 flex gap-1.5">
                        <Badge tone={profile.kind === "shared" ? "primary" : "neutral"}>
                          {profile.kind === "shared" ? "Compartilhado" : "Individual"}
                        </Badge>
                        <StatusBadge active={profile.active} />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {accounts} {accounts === 1 ? "conta" : "contas"} · {cards} {cards === 1 ? "cartão" : "cartões"}
                  </p>
                  <div className="mt-auto flex gap-2 border-t border-border pt-3">
                    <Button variant="secondary" size="sm" onClick={() => openForm(profile)}>
                      <Pencil className="size-3.5" aria-hidden /> Editar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggle(profile)}>
                      <Power className="size-3.5" aria-hidden /> {profile.active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <ProfileFormDialog open={formOpen} onClose={() => setFormOpen(false)} profile={editing} />
    </div>
  );
}
