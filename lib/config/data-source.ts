/**
 * Fonte de dados dos cadastros (Pessoas, Categorias, Contas, Cartões).
 * - "local": localStorage (modo demonstração, como nas etapas anteriores).
 * - "supabase": banco real, isolado por household via RLS.
 * NEXT_PUBLIC_* é resolvido em tempo de build: troque a variável e rode `npm run build` (ou reinicie o `dev`).
 */
export type DataSourceMode = "local" | "supabase";

export const DATA_SOURCE: DataSourceMode = process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase" ? "supabase" : "local";
