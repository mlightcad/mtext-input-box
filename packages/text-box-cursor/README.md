# @mlightcad/text-box-cursor

Renderer-agnostic text cursor and selection toolkit.

## Purpose

- Provide stable cursor movement/selection logic based on character boxes.
- Render cursor/selection overlays through pluggable adapters.
- Support both Canvas2D and Three.js environments with one API.

## Main Exports

- `TextBoxCursor`: pure cursor/selection logic.
- `CursorRenderer`: renderer-facing overlay controller.
- `Canvas2DRendererAdapter`: canvas implementation.
- `ThreeJsRendererAdapter`: Three.js implementation.

## Install

```bash
pnpm add @mlightcad/text-box-cursor
```

If you use `ThreeJsRendererAdapter`, install `three` as well.

## Quick Start

```ts
import { TextBoxCursor, type Box } from '@mlightcad/text-box-cursor';

const containerBox: Box = { x: 0, y: 0, width: 500, height: 200 };
const charBoxes: Box[] = [
  { x: 10, y: 20, width: 12, height: 20 },
  { x: 24, y: 20, width: 12, height: 20 }
];

const cursor = new TextBoxCursor({ containerBox, charBoxes });
cursor.moveRight();
cursor.setSelection(0, 2);
```

## `TextBoxCursorOptions`

```ts
interface TextBoxCursorOptions {
  containerBox: Box;
  charBoxes: (Box | null | undefined)[];
  lineBreakIndices?: number[];
  lineLayouts?: { y: number; height: number }[];
  initialIndex?: number;
  initialSelection?: { start: number; end: number };
  verticalAlign?: 'top' | 'center' | 'bottom';
  lineTolerance?: number;
  debug?: boolean;
}
```

- `containerBox`: outer editable region in screen-space pixels.
- `charBoxes`: per-character bounds in logical text order (no need to provide `\n` box).
- `lineBreakIndices`: optional explicit line breaks as half-open boundary indices.
- `lineLayouts`: optional per-line `y/height` from your text layout engine (visual line order).
- `initialIndex`: initial cursor index, clamped to `[0, charCount]`.
- `initialSelection`: initial selection range `[start, end)`.
- `verticalAlign`: cursor Y alignment against each line box.
- `lineTolerance`: geometry line-grouping tolerance (used when explicit breaks are not provided).
- `debug`: enables extra debug state snapshots.

### `lineBreakIndices` meaning

`lineBreakIndices` uses boundary indices between characters:

- Index `0` means before first character.
- Index `charCount` means after last character.
- Valid break values are internal boundaries: `1..charCount-1`.
- Break `k` means: split between character `k - 1` and `k`.

Example with 6 characters (`index: 0 1 2 3 4 5`):

- `lineBreakIndices: [2, 4]` creates lines:
  - line 1: chars `0..1`
  - line 2: chars `2..3`
  - line 3: chars `4..5`

### How to set `lineBreakIndices`

1. Build `charBoxes` in text order (do not include `\n` as a normal character box).
2. For each logical newline, push the current character count as a break index.
3. Pass that array to `TextBoxCursor`.

```ts
import { TextBoxCursor, type Box } from '@mlightcad/text-box-cursor';

const text = 'AB\nCD\nEF';
const charBoxes: Box[] = [
  { x: 10, y: 20, width: 10, height: 20 }, // A
  { x: 22, y: 20, width: 10, height: 20 }, // B
  { x: 10, y: 50, width: 10, height: 20 }, // C
  { x: 22, y: 50, width: 10, height: 20 }, // D
  { x: 10, y: 80, width: 10, height: 20 }, // E
  { x: 22, y: 80, width: 10, height: 20 }  // F
];

// Breaks after B (index 2) and after D (index 4).
const lineBreakIndices = [2, 4];

const cursor = new TextBoxCursor({
  containerBox: { x: 0, y: 0, width: 300, height: 120 },
  charBoxes,
  lineBreakIndices
});
```

### Empty line positioning (recommended)

If there are empty lines, provide `lineLayouts` from your text engine so cursor `y` is exact:

```ts
const cursor = new TextBoxCursor({
  containerBox: { x: 0, y: 0, width: 300, height: 160 },
  charBoxes: [
    { x: 10, y: 20, width: 10, height: 20 },
    { x: 22, y: 20, width: 10, height: 20 },
    { x: 10, y: 80, width: 10, height: 20 },
    { x: 22, y: 80, width: 10, height: 20 }
  ],
  lineBreakIndices: [2, 2],
  lineLayouts: [
    { y: 20, height: 20 }, // line 1
    { y: 50, height: 20 }, // empty line
    { y: 80, height: 20 }  // line 3
  ]
});
```

When `lineLayouts` is omitted, empty-line `y` falls back to internal estimation.

### When `lineBreakIndices` is not specified

`TextBoxCursor` falls back to geometry-based line detection from `charBoxes` order.

It scans adjacent boxes and starts a new line when either condition is true:

- `x` reset: current `x` is significantly smaller than previous `x` (controlled by `lineTolerance`).
- Strong vertical separation: large `y` jump with low vertical overlap ratio between adjacent boxes.

Then cursor position is computed from the detected line model:

- Cursor `y`: from that line's center/top/bottom (depends on `verticalAlign`).
- Cursor `x`: from the nearest gap in the current line (line start + every char right edge).
- Vertical movement (`moveUp`/`moveDown`): keeps preferred `x` and finds nearest gap on target line.

Practical notes:

- Keep `charBoxes` in logical text order.
- If your layout has mixed font sizes or noisy glyph boxes, increase `lineTolerance`.
- If your source already knows exact line breaks, prefer `lineBreakIndices` for deterministic behavior.

## Coordinate Model

`TextBoxCursor` expects top-left style coordinates:

- `x` grows to the right.
- `y` grows downward.

If your renderer uses another coordinate system, convert before passing boxes.

## Development

```bash
pnpm --filter @mlightcad/text-box-cursor lint
pnpm --filter @mlightcad/text-box-cursor test
pnpm --filter @mlightcad/text-box-cursor build
```
