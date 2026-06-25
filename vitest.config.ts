import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup/load-env.ts", "./tests/setup/dom.ts"],
    // Integration tests share one Neon DB; running files in parallel lets one
    // file's TRUNCATE ... CASCADE wipe rows another file is using. Run serially.
    fileParallelism: false,
    // Integration tests hit a real Neon branch (Singapore latency, many
    // round-trips + a migrate in beforeAll); the default 5s is too tight under
    // full-suite serial load. Headroom kills the seed-test timeout flake.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
