# solo-horror-engine

A rules engine for solo horror board games; content packs are supplied separately.

This repository ships no game content and has no affiliation with any publisher. The only bundled pack is a small invented demo.

## Development

Requires Node 24+. pnpm is pinned via `packageManager` (use `corepack pnpm` if pnpm is not installed).

```sh
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm check:leaks
pnpm build
```
