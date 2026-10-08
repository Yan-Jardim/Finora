"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ColorPicker, Field, FormFooter, IconPicker, Input, Select } from "@/components/forms/fields";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Dialog } from "@/components/ui/dialog";
import { duplicateCategoryName, validParentOptions } from "@/domain/rules";
import type { Category } from "@/domain/types";
import {
  categoryDefaults,
  categoryFromForm,
  categorySchema,
  categoryToForm,
  type CategoryFormValues,
} from "@/schemas/category";

export function CategoryFormDialog({
  open,
  onClose,
  category,
  parentId,
}: {
  open: boolean;
  onClose: () => void;
  category?: Category;
  /** Pré-seleciona o pai ao criar uma subcategoria. */
  parentId?: string;
}) {
  const title = category ? (category.parentId ? "Editar subcategoria" : "Editar categoria") : parentId ? "Nova subcategoria" : "Nova categoria";
  return (
    <Dialog open={open} onClose={onClose} title={title} description="Categorias organizam seus relatórios. Subcategorias detalham uma categoria principal.">
      <CategoryForm category={category} parentId={parentId} onClose={onClose} />
    </Dialog>
  );
}

function CategoryForm({
  category,
  parentId,
  onClose,
}: {
  category?: Category;
  parentId?: string;
  onClose: () => void;
}) {
  const { data, repos } = useWorkspace();
  const run = useAction();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: category ? categoryToForm(category) : { ...categoryDefaults, parentId: parentId ?? "" },
  });

  const parentOptions = validParentOptions(data.categories, category);
  const hasChildren = !!category && data.categories.some((c) => c.parentId === category.id);
  const selectedParentId = useWatch({ control, name: "parentId" });
  const parent = data.categories.find((c) => c.id === selectedParentId);
  // Subcategoria herda o tipo do pai (a menos que o pai aceite ambos).
  const lockedKind = parent && parent.kind !== "both" ? parent.kind : undefined;
  const color = useWatch({ control, name: "color" });

  const onSubmit = handleSubmit(async (values) => {
    const input = categoryFromForm(values);
    if (lockedKind) input.kind = lockedKind;

    const duplicate = duplicateCategoryName(input.name, input.parentId, data.categories, category?.id);
    if (duplicate) return setError("name", { message: duplicate });

    const ok = await run(async () => {
      if (category) {
        await repos.categories.update(category.id, input);
        // Mantém subcategorias coerentes com o tipo do pai.
        if (input.kind !== "both") {
          for (const child of data.categories.filter((c) => c.parentId === category.id && c.kind !== input.kind)) {
            await repos.categories.update(child.id, { kind: input.kind });
          }
        }
      } else {
        await repos.categories.create({ ...input, active: true });
      }
    }, category ? "Categoria atualizada." : "Categoria criada.");
    if (ok) onClose();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Nome" error={errors.name?.message}>
        {(p) => <Input {...p} placeholder="Ex.: Moradia" autoFocus {...register("name")} />}
      </Field>

      {hasChildren ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Esta categoria possui subcategorias, por isso não pode ser subcategoria de outra.
        </p>
      ) : (
        <Field label="Categoria pai" optional error={errors.parentId?.message} hint="Deixe vazio para uma categoria principal.">
          {(p) => (
            <Select {...p} {...register("parentId")}>
              <option value="">Nenhuma (categoria principal)</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field label="Tipo" error={errors.kind?.message} hint={lockedKind ? "Definido pela categoria pai." : undefined}>
        {(p) => (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Select {...p} value={lockedKind ?? field.value} onChange={field.onChange} disabled={!!lockedKind}>
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
                <option value="both">Ambos</option>
              </Select>
            )}
          />
        )}
      </Field>

      <Field label="Cor" error={errors.color?.message}>
        {() => <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />}
      </Field>

      <Field label="Ícone" error={errors.icon?.message}>
        {() => (
          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <div className="flex flex-col gap-3">
                <IconPicker value={field.value} onChange={field.onChange} color={color} />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CategoryIcon name={field.value} color={color} /> Pré-visualização
                </div>
              </div>
            )}
          />
        )}
      </Field>

      <FormFooter onCancel={onClose} submitting={isSubmitting} />
    </form>
  );
}
