import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["lib/**/*.test.ts"] },
  resolve: { alias: { "@": __dirname } },
});
