"use client";

import { CornerDownRight, FolderTree, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { categoryDeleteBlocker } from "@/domain/rules";
import type { Category } from "@/domain/types";
import { cn } from "@/lib/utils";
import { CategoryFormDialog } from "./category-form";

type KindFilter = "all" | "expense" | "income";
const filters: { id: KindFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "expense", label: "Despesas" },
  { id: "income", label: "Receitas" },
];
const kindLabel = { expense: "Despesa", income: "Receita", both: "Ambos" } as const;

const matches = (category: Category, filter: KindFilter) =>
  filter === "all" || category.kind === "both" || category.kind === filter;

interface FormState {
  open: boolean;
  category?: Category;
  parentId?: string;
}

export function CategoriesView() {
  const { data, ready, repos, seedDefaultCategories } = useWorkspace();
  const run = useAction();
  const [filter, setFilter] = useState<KindFilter>("all");
  const [form, setForm] = useState<FormState>({ open: false });
  const [deleting, setDeleting] = useState<Category | undefined>();

  if (!ready) return <PageSkeleton />;

  const roots = data.categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => data.categories.filter((c) => c.parentId === id && matches(c, filter));
  const visibleRoots = roots.filter((r) => matches(r, filter) || childrenOf(r.id).length > 0);

  const toggle = (category: Category) =>
    run(
      () => repos.categories.update(category.id, { active: !category.active }),
      category.active ? "Categoria desativada." : "Categoria ativada.",
    );

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Nova categoria
    </Button>
  );

  const renderRow = (category: Category, isChild: boolean) => (
    <li
      key={category.id}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-3", isChild && "pl-4 sm:pl-8", !category.active && "opacity-60")}
    >
      {isChild && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <CategoryIcon name={category.icon} color={category.color} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-sm font-medium">{category.name}</span>
        <Badge>{kindLabel[category.kind]}</Badge>
        {!category.active && <StatusBadge active={false} />}
      </div>
      <div className="flex gap-1">
        {!isChild && (
          <Button variant="ghost" size="sm" onClick={() => setForm({ open: true, parentId: category.id })} aria-label={`Nova subcategoria em ${category.name}`}>
            <Plus className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Subcategoria</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setForm({ open: true, category })} aria-label={`Editar ${category.name}`}>
          <Pencil className="size-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toggle(category)} aria-label={category.active ? `Desativar ${category.name}` : `Ativar ${category.name}`} title={category.active ? "Desativar" : "Ativar"}>
          <Power className="size-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDeleting(category)} aria-label={`Excluir ${category.name}`}>
          <Trash2 className="size-3.5 text-danger" aria-hidden />
        </Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categorias"
        description="Personalize como seus gastos e receitas são organizados."
        action={data.categories.length > 0 ? newButton : undefined}
      />

      {data.categories.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderTree}
            title="Nenhuma categoria cadastrada"
            description="Crie categorias como Moradia ou Alimentação para entender para onde seu dinheiro vai."
          />
          <div className="flex flex-wrap justify-center gap-2 pb-6">
            {seedDefaultCategories && (
              <Button onClick={() => run(seedDefaultCategories, "Categorias padrão adicionadas.")}>Adicionar categorias padrão</Button>
            )}
            {seedDefaultCategories ? <Button variant="secondary" onClick={() => setForm({ open: true })}><Plus className="size-4" aria-hidden /> Nova categoria</Button> : newButton}
          </div>
        </Card>
      ) : (
        <>
          <div role="tablist" aria-label="Filtrar por tipo" className="inline-flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
            {filters.map((option) => (
              <button
                key={option.id}
                role="tab"
                aria-selected={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  filter === option.id ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Card className="p-0">
            {visibleRoots.length === 0 ? (
              <EmptyState icon={FolderTree} title="Nenhuma categoria neste filtro" />
            ) : (
              <ul className="divide-y divide-border px-4 sm:px-5">
                {visibleRoots.map((root) => (
                  <li key={root.id} className="list-none">
                    <ul>
                      {renderRow(root, false)}
                      {childrenOf(root.id).map((child) => renderRow(child, true))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <CategoryFormDialog
        open={form.open}
        onClose={() => setForm({ open: false })}
        category={form.category}
        parentId={form.parentId}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Excluir "${deleting?.name}"?`}
        description="Esta ação não pode ser desfeita."
        blockedReason={deleting ? (categoryDeleteBlocker(deleting, data) ?? undefined) : undefined}
        onConfirm={() => run(() => repos.categories.remove(deleting!.id), "Categoria excluída.")}
      />
    </div>
  );
}
