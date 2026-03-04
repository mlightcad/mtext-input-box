# @mlightcad/demo-mtext-input-box

Demo app for `@mlightcad/mtext-input-box`.

## Purpose

- Demonstrate interactive MTEXT editing in Three.js.
- Validate cursor movement, selection, IME input, formatting, undo/redo.
- Demonstrate multi-editor activation/closing/re-opening in one canvas.
- Validate floating toolbar positioning while zooming/panning.
- Inspect runtime state (`currentFormat`, selection, cursor layout, AST, raw MTEXT diff).

## Notes

- The toolbar is created by `MTextInputBox` (not by demo app UI).
- The demo provides extra controls: toolbar theme toggle and debug visibility toggles.
- Click outside an active editor to close it, then double-click its rendered text to reopen it.

## Run

```bash
pnpm --filter @mlightcad/demo-mtext-input-box dev
```

## Build

```bash
pnpm --filter @mlightcad/demo-mtext-input-box build
```
