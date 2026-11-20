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
- **Resolution.** `src/core/resolve.ts` drives a stack of JSON frames (effects, scopes, play windows, finish) until exactly one decision is pending or the game ends. `GameState.status` is `awaitingDecision`, `finished` or `faulted`. Runaway pack data hits an operation cap: `step` returns `engineFault` with state unchanged; a fault during `init` yields a `faulted` state.
- **Units and map.** Units have an id, a kind, attribute counters and a placement (on a space, inside another unit, or off the map); `src/core/graph.ts` holds the pure graph queries over the current edges; an edge's `fromTags`/`toTags` count only when it is left from that end, and filters see them. `stepMove` may be `forced` (no stopping; a single option is taken without a decision). Both moves take `freeWhen` (a step into a space where it holds, `candidate` = that space, uses up no step) and check `stopWhen` before every step; `stepMove` offers only steps into spaces where `enterWhen` holds (`candidate` = that space), and `moveToward` takes only such steps (when it refuses every step toward its target it runs `blocked` with `candidate` = the first refused space and ends); `moveToward` also takes `endWhen`: it may pass other spaces but ends only on one where it holds, looking ahead along shortest paths so it stops as far along as its steps allow; `stepMove` also takes `instead { when, effects }`: a step from a space where `when` holds runs `effects` instead of a chosen step, and followers then follow to wherever the mover ended. Movement resolves one step per frame, so checks and triggers run between steps. Unresolvable unit or space references make an effect a no-op. `UnitKind.countsAs` lists kinds a unit also matches everywhere a kind is matched (one level). A `unitRemoved` event carries `fromSpace`, and triggers on it see that space as `candidate`.
- **Ordering, quantities, costs.** `forEachUnit`/`selectUnits` snapshot their candidates, sort by pack keys and break ties by id, seeded random pick or a `pickUnit` decision. `moveToward` orders equally short next steps the same way (sort keys see the step as the `"candidate"` space; a decision is a `moveUnit` without pass). `selectSpaces { where, order, count, effects }` picks spaces the same way (no decision: ties by id or seeded random) and runs `effects` with each as `candidate`. Expression selectors (`closest`, `farthest`, with an optional `where` checked with `self` = each candidate unit) cannot ask and use id order. `deliver` sends a typed quantity to a counter or unit attribute; modifiers (lowest priority first, then id; optional ones offered as a choice with pass) prevent, reduce, increase, convert or substitute it first. Options, cards and edges may carry costs; only payable ones are listed, and discards are paid one `pickCard` at a time. A counter cost's optional `floor` makes a non-zero cost unpayable if it would leave the counter below the floor.
- **Procedures.** `procedures` (layered) are named effect lists with numeric `params`; `{ type: "call", procedure, args }` evaluates the args in the caller's context and runs the effects with them, readable as `{ arg }`. `procedureIssues` (`src/core/procedures.ts`) checks exact args, arg scope and no cycles, in `parsePack` and again in `composeRules`.
- **Windows.** A `playWindow` decision (`window`) lists `playCard` (optional `play { from, to, cards }`, cards passing the tag filter), `discardCard` (optional `discard { from, to, effects }`), `buyCard` (optional `buy { from, to, cards, when, free }`: moves the card, pays its `buyCost` unless free, runs no effects) and `useAbility` (abilities of face-up cards in `abilitiesFrom`), plus pass; `repeat: false` closes it after one action; `until` closes it without a decision whenever it would open (again) and the condition holds. Card `abilities` have `when`, `cost` and `limit { uses, per }`; uses are counted in `GameState.abilityUses` and cleared when the `per` scope exits.
- **Resolving cards.** `{ type: "resolveCard", zone, to, ifEmpty }` takes the top card (moving it to `to` first), emits `cardResolved` and runs its `effects` without a decision, ignoring `playable` and `cost`; a card still face down runs its zone's `backEffects` instead, so resolving never identifies a hidden card.
- **This card and card counters.** `ExpressionContext.card` is "this card": the played card, the card whose ability is used (also for its `when` and `cost`), a resolved face-up card, or each card of `forEachCard { zone, cards, effects }`; it passes through `call`. `Card.counters` start on every copy (`GameState.cardCounters`), read with `{ cardCounter }` and changed with `changeCardCounter`, both on this card only; `view` shows them on face-up cards. `moveThisCard { to, position }` moves this card from wherever it lies; `{ thisCard: { zone, tag } }` tests it. `pickCards { from, to, count, cards, optional, position }` asks one `pickCard` per card (with pass when optional) among face-up cards only.
- **Card parts.** `Card.parts { id, text, effects }`: `revealCardPart { zone, part }` reveals one part of the zone's top card without turning it face up (its text goes into `GameState.revealedParts` and runs its effects, once per part); `view` lists the revealed texts on the card (`ViewCard.revealed`), also while face down; a reveal is an undo barrier; shuffling the zone forgets the revealed parts of its face-down cards. The UI draws such a card veiled, with each new line sweeping in.
- **Card presence.** `{ countCards: { zone, card, tag } }` counts face-up cards in a zone (by definition id and/or tag), for conditions such as "while this card is in that zone"; face-down cards never count. `{ topFaceUp: zone }` tells whether the top card is face up. A `cardsMoved` trigger may name a `card` (which cards the trigger matches): it fires only when a copy of that card is faceup after the card moves, and runs with that copy as this card.
- **Followers.** `stepMove`/`moveToward` may carry `followers { units { kind, where }, max, min, when }`: after each step a `follow` frame offers `pickUnit` with pass (`canPass`) for units left behind, up to `max`, and without pass until `min` have followed while any are left; `when` is checked with `candidate` = destination, and so is each follower's `units.where` (with `self` = the follower).
- **Dice and random tables.** Named pools hold dice (ids `d1..dn` per roll) of pack-defined die types whose faces carry symbol counts, read with `diceCount`. Rerolls, face changes and role assignment ask one `pickDie` at a time; a chosen reroll may set `max` dice. `lookup` maps a number to ranges; `randomTable` makes one weighted seeded draw over the eligible entries, with `ifNone` for an empty set.
- **Hidden cards and projections.** Face-down cards are addressed by handles (`h<n>`), minted when a card goes face down and re-minted on shuffle; `peek` marks cards known until their zone is shuffled. The UI uses only the projections in `src/core/view.ts` (`view`, `viewActions`, `viewEvents`, `viewError`), never raw state; `step` accepts handles in actions. `viewActions` offers identical-looking visible cards once.
- **Undo.** `StepOutcome.undoBarrier` is true when a step drew randomness or let the player identify a hidden card. `undo` replays the log and refuses (`undoBlocked`) when the last action was a barrier; `canUndo` asks the same.
- **Pack format v2.** A core is `{ meta, base, modules, choices }`; an add-on is `{ meta: { ..., core }, module }`, one module loaded on its own. `combineAddOns` (`src/content/combine.ts`) joins a core with its add-ons into one `Pack` and runs the checks that need everything present. Modules patch the base by id in precedence order (`src/core/compose.ts`); a choice lists `options` and/or names a `kind` (every module of that kind); choosing modules is the first decisions in the log. `setupEnd` runs after every chosen module's setup. The design for later roadmap steps is in `docs/engine-plan.md`.
- **Display data.** Optional pack fields used only by the UI: names for counters, zones and dice pools, counter and unit attribute `hidden` (kept out of the tracks panel; a unit whose attributes are all hidden or 0-valued flags counts as a piece without attributes), `show` on counters, unit attributes and zones (`main`: counters and attributes in the status strip under the top bar, zones first in the cards panel; `flag`: counter named in the strip only while not 0; `minor`: one compact row under a folded "More"; default `normal`), module `name` and `note` (a short line shown when the module is offered), card `text` and `image` (a relative path or a `data:` URL), unit kind `image`, `color` and `badge` (piece chips on the board), die type `symbols` (`name`, `plural`: rolls in the log count each named symbol), and `boards` (a layered collection with `name`, `image`, `aspect`) with `Space.position { board, x, y }` in percent (or, for a space on a movable map tile, `Space.positionBy { counter, positions [{ value, board, x, y }] }`: drawn at the entry matching the counter, else at `position`), and `edgeMarks` (`tag`, `badge`, `name`, `color`: edges with that tag are drawn dashed in that colour and badged on both end spaces, explained in the space sheet). Missing names fall back to ids. The engine never reads them.
- **UI.** Vanilla TypeScript and DOM, no framework (`src/ui/dom.ts` has the `h` helper). The screen re-renders from `view`/`viewActions` after every action: `board.ts` (spaces as buttons over an SVG of the edges; legal moves are highlighted and tappable), `panels.ts` (tracks, zones, log; the log sits in a drawer that slides in over everything from a tag on the right edge), `decision.ts` (pinned bar with one button per offered action), `sheet.ts` (details in a modal bottom sheet). `labels.ts` turns ids into display text using rules composed for the chosen modules and only projected data, so it cannot name a hidden card. After an action, `playback.ts` turns the steps' `viewEvents` into beats (a piece moved or removed, or a visible card resolved, with the other events as caption lines); `main.ts` shows them one by one on the board (focus outline, pieces sliding, "Next" / "Skip to now") before the real state, unless the menu's "Show automatic steps" is off. Each beat is described in an in-app toast (`toast.ts`, stacked above the decision bar, tap to go on) and lasts its reading time (`readingMilliseconds`: grows with the words, clamped, scaled by the reading speed). Player settings (`settings.ts`: show automatic steps, reading speed) sit in a Settings section of the menu and are kept in `localStorage`. The log is not saved; on resume it is rebuilt while replaying the saved actions (`replayWithLog`, `src/ui/game-log.ts`).
- **Data-driven.** The engine knows generic concepts; a content pack chooses which a game uses. Nothing game-specific is hardcoded. Packs are plain JSON plus asset files referenced by relative path, never code. `parsePack(input: unknown): Result<Pack, PackError>` takes already-fetched data.
- **Layering:** `ui -> content -> core`. Core has plain TS pack types and zero runtime dependencies. Zod lives only in `src/content`, and the schema is checked against the core `Pack` type at compile time. Enforced by ESLint `no-restricted-imports` per directory; core also bans `Math.random`, `Date` and `performance`, and has its own `tsconfig.core.json` with `lib: ["ES2022"]` so DOM use fails typecheck.

## Build and leak safety

- `build` bundles only `content/demo` via a static import in `src/ui/main.ts`. Never add a glob import or copy step that could match `content/private`. There is no private build: a core and add-ons are loaded at runtime from files the player picks (menu, "Load core or add-on file"), told apart by `parseLibraryFile` and kept in the browser by `LibraryStore` (`src/ui/pack-store.ts`, `localStorage`: one core, many add-ons, removable in the menu); the page then reloads with the combination. Where the browser can pick a folder (`src/ui/folder-source.ts`), the menu also remembers a folder (handle in IndexedDB) and re-reads every loaded core and add-on from it by id (`refreshLibrary`). Images referenced by relative path are not loaded this way yet; a pack may embed them as `data:` URLs.
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

`SaveStore` (`src/ui/save-store.ts`) with a `localStorage` implementation. A save is `{ engineVersion, packId, packVersion, seed, actions }`, written after every action under a key per pack id. On reload the game resumes by replay. On any version mismatch it does not replay; it reports the mismatch and offers a new game. A replay failure is treated as a corrupt save.

## Layout

```
content/demo/        invented demo pack (committed)
content/private/     real content, gitignored (packs/, rules/, notes/)
docs/                public, generic engine docs (design: docs/engine-plan.md)
scripts/             check-leaks.mjs
src/core/            pure engine: result, rng, pack types, model, engine, replay, version
src/content/         Zod schema and parsePack
src/ui/              browser UI: screen, board, panels, labels, save store
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
