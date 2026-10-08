export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/** Limpa uma tag digitada: remove "#", espaços extras e limita o tamanho. "#Casa  nova" -> "Casa nova". */
export function cleanTag(raw: string): string {
  return raw.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
}

/** Lista estruturada de tags: sem vazias, sem duplicadas (ignora maiúsculas), no máximo MAX_TAGS. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = cleanTag(raw);
    const key = tag.toLocaleLowerCase("pt-BR");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, MAX_TAGS);
}
