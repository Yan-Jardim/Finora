"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { cleanTag, MAX_TAGS, MAX_TAG_LENGTH, normalizeTags } from "@/lib/tags";

/**
 * Campo de tags: digite e pressione Enter ou vírgula. Valor é uma lista estruturada
 * (string[]), nunca uma string única. `suggestions` alimenta o autocompletar.
 */
export function TagInput({
  id,
  value,
  onChange,
  suggestions = [],
}: {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  const commit = (raw: string) => {
    const tag = cleanTag(raw);
    if (tag) onChange(normalizeTags([...value, tag]));
    setDraft("");
  };

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
          #{tag}
          <button type="button" aria-label={`Remover tag ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        list={listId}
        value={draft}
        maxLength={MAX_TAG_LENGTH}
        disabled={value.length >= MAX_TAGS}
        placeholder={value.length === 0 ? "Ex.: Londres, Viagem, Casa nova" : value.length >= MAX_TAGS ? "" : "Adicionar…"}
        onChange={(e) => {
          if (e.target.value.endsWith(",")) commit(e.target.value.slice(0, -1));
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // não envia o formulário
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground/70"
      />
      <datalist id={listId}>
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
