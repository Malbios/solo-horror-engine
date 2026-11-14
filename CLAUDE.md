# solo-horror-engine

## Hard constraint: no published game content

This repo is public. It must NEVER contain content from any existing published game: no game names, card names, card text, flavour text, rulebook wording, artwork, or stats, costs, quantities or deck compositions taken from a published game.

- Real game content lives under `content/private/`, which is gitignored: content packs in `content/private/packs/`, the rulebook in `content/private/rules/`, private planning notes in `content/private/notes/`.
- All examples, tests, fixtures, snapshots, identifiers, comments, schema field names, commit messages, branch names and PR text must be invented and generic.
- Reading anything under `content/private/` is allowed; the safeguard is only on what reaches the public repo. Never copy from it into anything outside `content/private/`.
- Do not guess which game this is for, and do not draw on knowledge of any published game when naming things or inventing demo content. Avoid genre terms the user has not supplied.
- Tests and saved games that use a private pack live under `content/private/` only.
- If a task seems to need real content outside `content/private/`, stop and ask.
- Stage files by explicit path only. Never `git add -A` or `git add .`.

## Working with the rulebook

When the user asks you to read the rules in `content/private/rules/`, read them fully; the real rules are needed to design the engine. The safeguard is on what you write, not what you read. Always produce two separate outputs:

- **Private mapping** in `content/private/notes/` (e.g. `mapping/`): source terms, components and rules, each mapped to a generic engine concept, with file and page references. Game-specific detail lives only here. Grow `.private-terms.txt` (gitignored, one term per line) with distinctive terms in the same pass.
- **Public plan** in `docs/` (e.g. `docs/engine-plan.md`): generic engine terms only. Publish primitives, never combinations: a list of individually generic mechanics can still identify a source in aggregate. No source terms, no rulebook wording, no close paraphrases, no specific numbers or card lists, no description of how the sources are organised.

Code, types, comments, tests and commit messages use the generic vocabulary from the public plan, never terms from the sources or the private mapping. After writing a public plan or code based on the rules, list every term you were unsure about so the user can review before committing. Draft public plans under `content/private/notes/` and move them to `docs/` only after review.

## Architecture

- **Engine API.** `createEngine(pack)` returns `{ init(seed), step(state, action), legalActions(state) }`. `step` returns `Result<{ state, events }, RuleError>`. All functions are pure: no mutation, no I/O.
- **State.** `GameState` holds only instance data and references pack definitions by id. `GameState`, `Action` and `GameEvent` are JSON-serialisable (no classes, Map/Set, bigint or undefined-valued keys).
- **Types.** `Result<T, E>` lives in `src/core` (no library). `Action`, `GameEvent` and `RuleError` are discriminated unions on `type`, handled with exhaustive `switch` and `assertNever`.
- **RNG.** sfc32 in `src/core/rng.ts`, state is four uint32 numbers stored in `GameState`. `next(rng): [number, Rng]`, `nextInt` (rejection sampling), `shuffle`. Any change to the algorithm or draw order must bump `ENGINE_VERSION`.
- **Action log is the source of truth.** Replay folds `step` over seed and actions (`replay`); undo replays without the last action (`undo`). Events are derived output for UI, animation and debugging, never persisted as authoritative.
- **Data-driven.** The engine knows generic concepts; a content pack chooses which a game uses. Nothing game-specific is hardcoded. Packs are plain JSON plus asset files referenced by relative path, never code. `parsePack(input: unknown): Result<Pack, PackError>` takes already-fetched data.
- **Layering:** `ui -> content -> core`. Core has plain TS pack types and zero runtime dependencies. Zod lives only in `src/content`, and the schema is checked against the core `Pack` type at compile time. Enforced by ESLint `no-restricted-imports` per directory; core also bans `Math.random`, `Date` and `performance`, and has its own `tsconfig.core.json` with `lib: ["ES2022"]` so DOM use fails typecheck.

## Build and leak safety

- `build` bundles only `content/demo` via a static import in `src/ui/main.ts`. Never add a glob import or copy step that could match `content/private`. No private build exists yet.
- Vite: `publicDir: false`, `optimizeDeps.entries` limited to `index.html`, dev server denies `content/private/**`. Vitest only collects `tests/**/*.test.ts`. ESLint and Prettier ignore `content/private`.
- `check:leaks` (`scripts/check-leaks.mjs`) fails if `git ls-files content/private` returns anything (case-insensitive), and scans staged added lines, staged paths and the commit message against `.private-terms.txt` (normalised: case, punctuation and line breaks ignored, camelCase split into words; matches whole words and simple plurals). It also rejects em dashes. A terms file that exists but has no terms is an error. `--scan-dir <dir>` scans a folder such as `dist/`; `--terms <file>` overrides the terms file.
- Hooks (simple-git-hooks, installed by `prepare`): pre-commit and commit-msg run `node scripts/check-leaks.mjs` directly.
- CI has no terms file, so CI only gets the tracked-files and em dash checks. CI only ever builds the demo pack.
- Vitest snapshots only for demo-pack state.

## Platform constraints (for future UI work)

The game must be fully playable on desktop browsers and phones (portrait first, landscape supported).

- Mobile-first, responsive layout designed for a ~360px-wide portrait screen, then scaled up. CSS grid/flex and container queries; no fixed-width layouts.
- Tap alone must suffice: no hover-only information, no right-click, no drag-only actions. Tap targets at least 44x44px.
- Small screens use focus views: a compact board overview, with hand, discard, tracks and card details as panels or sheets. Card details open on tap and stay open until dismissed.
- Use `click` on semantic `<button>` elements for activation; Pointer Events only for gestures (drag, long-press). Never separate mouse and touch handlers. Everything operable by keyboard.
- Respect `env(safe-area-inset-*)` and use `dvh` units.
- Must run smoothly on a mid-range phone; no heavy animation libraries, small bundle.
- Any future "export save" or "bug report" output is treated as private when a non-demo pack is loaded.
- Later (not now): installable PWA with offline support.

## Saves

`SaveStore` (`src/ui/save-store.ts`) with a `localStorage` implementation. A save is `{ engineVersion, packId, packVersion, seed, actions }`, written after every action. On reload the game resumes by replay. On any version mismatch it does not replay; it reports the mismatch and offers a new game. A replay failure is treated as a corrupt save.

## Layout

```
content/demo/        invented demo pack (committed)
content/private/     real content, gitignored (packs/, rules/, notes/)
docs/                public, generic engine docs (design: docs/engine-plan.md)
scripts/             check-leaks.mjs
src/core/            pure engine: result, rng, pack types, model, engine, replay, version
src/content/         Zod schema and parsePack
src/ui/              browser entry point and save store
tests/               Vitest suites (demo pack and invented fixtures only)
```

## Commands

pnpm is pinned via `packageManager`. If `pnpm` is not on PATH, prefix commands with `corepack` (e.g. `corepack pnpm test`).

- `pnpm dev`: Vite dev server
- `pnpm build`: production build of the demo pack
- `pnpm test`: Vitest
- `pnpm lint`: ESLint and Prettier check
- `pnpm typecheck`: core tsconfig, then the full tsconfig
- `pnpm check:leaks`: leak check on the index and staged changes

TypeScript is held on 6.0.x because typescript-eslint does not yet support TypeScript 7.

## Git

Commit finished work; never push. No AI attribution trailers in commit messages.
