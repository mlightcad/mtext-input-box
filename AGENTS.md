# AGENTS.md

## Project Overview
This repo is a pnpm monorepo for a Three.js-rich MTEXT editor and related demos.
Core packages live under `packages/`:
- `packages/text-box-cursor`: renderer-agnostic cursor/selection engine.
- `packages/mtext-input-box`: Three.js MTEXT editor component with IME bridge + toolbar.
- `packages/demo-canvas-cursor`: Canvas2D demo app.
- `packages/demo-three-cursor`: Three.js cursor demo app.
- `packages/demo-mtext-input-box`: Three.js MTEXT editor demo app.

## Tooling
- Package manager: `pnpm` (repo expects `pnpm@9.14.2`).
- Language: TypeScript (ESM).
- Demos use Vite (`pnpm --filter <pkg> dev`).

## Install
```bash
pnpm install
```

## Common Commands (workspace root)
```bash
pnpm build
pnpm lint
pnpm test
pnpm dev:canvas
pnpm dev:three
pnpm dev:mtext
```

## Package-Scoped Commands
Use `pnpm --filter <pkg>` to target a single package.
Examples:
```bash
pnpm --filter @mlightcad/text-box-cursor test
pnpm --filter @mlightcad/mtext-input-box build
pnpm --filter @mlightcad/demo-mtext-input-box dev
```

## Tests
- `@mlightcad/text-box-cursor` uses Vitest with coverage.
- `@mlightcad/mtext-input-box` uses Vitest.
- Demo packages do not have tests; they are built with Vite.

## Notes For Changes
- Prefer editing TypeScript sources under `packages/*/src/`.
- Keep changes consistent with existing ESM + TypeScript patterns.
- If touching demos, verify with the relevant `pnpm --filter <demo> dev` or `build`.
- `@mlightcad/mtext-input-box` expects `@mlightcad/mtext-renderer` and `three` as peer deps in consuming apps.
