import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// I test che usano il DB locale si chiamano `*-db.test.ts`: condividono dati (es. shop_settings),
// quindi girano in un progetto separato, un file alla volta. I test puri restano in parallelo.
const DB_TESTS = ["tests/acceptance/**/*-db.test.ts", "src/**/*-db.test.ts"];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/acceptance/**/*.test.ts", "src/**/*.test.ts"],
          exclude: DB_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: DB_TESTS,
          fileParallelism: false,
        },
      },
    ],
  },
});
