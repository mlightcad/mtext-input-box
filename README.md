# Rich Text Editor for Three.js

This monorepo focuses on one key idea: build a rich text editor in Three.js, with a document model based on AutoCAD MTEXT.

![MText Editor](./docs/mtext-editor.webp)

## Purpose

- Build and validate a Three.js-first rich text editing workflow for CAD scenarios.
- Keep the editor document model compatible with AutoCAD MTEXT concepts.
- Provide reusable building blocks: cursor/selection engine, MTEXT editor, and toolbar UI.
- Provide demo apps for Canvas2D cursor rendering, Three.js cursor rendering, and MTEXT editing.

![arch diagram](./docs/architecture.svg)

## Demo

- Live demo: [mtext-input-box demo app](https://mlightcad.github.io/mtext-input-box/)

## Packages

- `@mlightcad/text-box-cursor` (`packages/text-box-cursor`): renderer-agnostic cursor + selection engine, with Canvas2D and Three.js adapters.
- `@mlightcad/mtext-input-box` (`packages/mtext-input-box`): Three.js MTEXT input component with IME bridge and built-in floating toolbar.
- `@mlightcad/demo-canvas-cursor` (`packages/demo-canvas-cursor`): Canvas2D demo for cursor/selection rendering and interactions.
- `@mlightcad/demo-three-cursor` (`packages/demo-three-cursor`): Three.js demo for cursor/selection rendering and interactions.
- `@mlightcad/demo-mtext-input-box` (`packages/demo-mtext-input-box`): Three.js MTEXT demo (multi-editor, debug panel, raw MTEXT/AST views).

## Workspace Scripts

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

Run a specific demo app in local development:

```bash
pnpm dev:canvas
pnpm dev:three
pnpm dev:mtext
```

- `pnpm dev:canvas`: starts the Canvas2D cursor demo (`@mlightcad/demo-canvas-cursor`).
- `pnpm dev:three`: starts the Three.js cursor demo (`@mlightcad/demo-three-cursor`).
- `pnpm dev:mtext`: starts the Three.js MTEXT editor demo (`@mlightcad/demo-mtext-input-box`).

```bash
pnpm publish:mtext
```

`publish:mtext` builds the workspace and publishes `@mlightcad/text-box-cursor` and `@mlightcad/mtext-input-box`.
