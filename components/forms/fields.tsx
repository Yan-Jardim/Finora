"use client";

import { Check } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { ICONS, ICON_NAMES } from "@/components/ui/category-icon";
import { COLOR_PALETTE } from "@/lib/palette";
import { cn } from "@/lib/utils";

/** Primitivos de formulário reutilizáveis (compatíveis com `register` do react-hook-form). */

const controlStyle =
  "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

export function Field({
  label,
  error,
  hint,
  optional,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const id = useId();
  const messageId = `${id}-msg`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(opcional)</span>}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": error || hint ? messageId : undefined })}
      {(error || hint) && (
        <p id={messageId} className={cn("text-xs", error ? "text-danger" : "text-muted-foreground")} role={error ? "alert" : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlStyle, className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(controlStyle, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  ...props
}: React.ComponentProps<"input"> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...props} />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2">
      {COLOR_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={`Cor ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition focus-visible:outline-2 focus-visible:outline-primary",
            value === color && "ring-2 ring-foreground/60",
          )}
          style={{ backgroundColor: color }}
        >
          {value === color && <Check className="size-4 text-white" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function IconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color: string;
}) {
  return (
    <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name];
        const selected = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={name}
            onClick={() => onChange(name)}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg border transition",
              selected ? "border-transparent" : "border-border text-muted-foreground hover:bg-muted",
            )}
            style={selected ? { backgroundColor: `${color}22`, color } : undefined}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export function FormFooter({
  onCancel,
  submitting,
  submitLabel = "Salvar",
}: {
  onCancel: () => void;
  submitting: boolean;
  submitLabel?: string;
}) {
  return (
    <div className="mt-2 flex justify-end gap-2 border-t border-border pt-4">
      <Button variant="secondary" onClick={onCancel} disabled={submitting}>
        Cancelar
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Salvando…" : submitLabel}
      </Button>
    </div>
  );
}
