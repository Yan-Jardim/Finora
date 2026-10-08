import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    // Os beforeAll de paridade fazem login + limpeza + bootstrap (e repetem leituras em falha transitória do gateway).
    hookTimeout: 60_000,
  },
});
