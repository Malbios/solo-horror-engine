import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: false,
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "content/private/**"],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
