import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const coreBannedGlobals = [
  { name: "Date", message: "Core must be deterministic: no wall-clock time." },
  { name: "performance", message: "Core must be deterministic: no timers." },
];

export default defineConfig(
  globalIgnores(["content/private/**", "dist/**", "dist-private/**", "coverage/**"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "zod", message: "Core has no runtime dependencies." }],
          patterns: [
            { group: ["**/content", "**/content/**"], message: "Core must not import content." },
            { group: ["**/ui", "**/ui/**"], message: "Core must not import ui." },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...coreBannedGlobals],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded RNG in core/rng." },
      ],
    },
  },
  {
    files: ["src/content/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["**/ui", "**/ui/**"], message: "Content must not import ui." }],
        },
      ],
    },
  },
  {
    files: ["src/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "zod", message: "Zod is only used in src/content." }] },
      ],
    },
  },
  prettier,
);
