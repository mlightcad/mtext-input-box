import { describe, expect, test } from 'vitest';
import { TextBoxCursor } from '../src/TextBoxCursor';
import type { CharBoxInput } from '../src/types';

function makeCursor(charBoxes: CharBoxInput[], lineTolerance = 5): TextBoxCursor {
  return new TextBoxCursor({
    containerBox: { x: 0, y: 0, width: 800, height: 600 },
    charBoxes,
    lineTolerance
  });
}

describe('line detection', () => {
  test('detects strict multiline by Y jump', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 },
      { x: 24, y: 140, width: 10, height: 20 }
    ]);
    expect(cursor.getLineCount()).toBe(2);
    expect(cursor.getLines()[0]!.startIndex).toBe(0);
    expect(cursor.getLines()[1]!.startIndex).toBe(2);
  });

  test('treats small y jitter as one line within tolerance', () => {
    const cursor = makeCursor(
      [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 103, width: 10, height: 20 },
        { x: 38, y: 101, width: 10, height: 20 }
      ],
      5
    );
    expect(cursor.getLineCount()).toBe(1);
  });

  test('supports gradual y slope as single line', () => {
    const cursor = makeCursor(
      [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 102, width: 10, height: 20 },
        { x: 38, y: 104, width: 10, height: 20 }
      ],
      5
    );
    expect(cursor.getLineCount()).toBe(1);
  });

  test('does not split a row when mixed-height glyphs still overlap vertically', () => {
    const cursor = makeCursor(
      [
        { x: 70, y: 509, width: 13, height: 22 },
        { x: 151, y: 513, width: 7, height: 33 },
        { x: 159, y: 509, width: 16, height: 22 },
        { x: 70, y: 409, width: 14, height: 22 },
        { x: 90, y: 409, width: 8, height: 22 }
      ],
      4
    );

    expect(cursor.getLineCount()).toBe(2);
    expect(cursor.getLines()[0]).toMatchObject({ startIndex: 0, endIndex: 2 });
    expect(cursor.getLines()[1]).toMatchObject({ startIndex: 3, endIndex: 4 });
  });

  test('handles empty array', () => {
    const cursor = makeCursor([]);
    expect(cursor.getLineCount()).toBe(0);
    expect(cursor.getCursorPosition()).toEqual({ x: 0, y: 0 });
  });

  test('uses explicit line break separators from charBoxes', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      null,
      { x: 10, y: 100, width: 10, height: 20 }
    ]);
    expect(cursor.getLineCount()).toBe(2);
    expect(cursor.getLines()[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(cursor.getLines()[1]).toMatchObject({ startIndex: 2, endIndex: 2 });
  });

  test('uses explicit line break indices over geometry', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 }
      ],
      lineBreakIndices: [2]
    });
    expect(cursor.getLineCount()).toBe(2);
    expect(cursor.getLines()[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(cursor.getLines()[1]).toMatchObject({ startIndex: 2, endIndex: 3 });
  });

  test('supports explicit empty line via duplicate break index', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [2, 2],
      lineLayouts: [
        { y: 100, height: 20 },
        { y: 120, height: 20 },
        { y: 140, height: 20 }
      ]
    });

    expect(cursor.getLineCount()).toBe(3);
    expect(cursor.getLines()[0]).toMatchObject({ startIndex: 0, endIndex: 1, charCount: 2 });
    expect(cursor.getLines()[1]).toMatchObject({ startIndex: 2, endIndex: 1, y: 120, charCount: 0 });
    expect(cursor.getLines()[2]).toMatchObject({ startIndex: 2, endIndex: 3, y: 140, charCount: 2 });
  });

  test('supports leading and trailing empty lines via boundary break indices', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 }
      ],
      lineBreakIndices: [0, 2]
    });

    expect(cursor.getLineCount()).toBe(3);
    expect(cursor.getLines()[0]).toMatchObject({ startIndex: 0, endIndex: -1, charCount: 0 });
    expect(cursor.getLines()[1]).toMatchObject({ startIndex: 0, endIndex: 1, charCount: 2 });
    expect(cursor.getLines()[2]).toMatchObject({ startIndex: 2, endIndex: 1, charCount: 0 });
  });
});

describe('cross-line movement', () => {
  test('moveDown from first line start lands at second line start (line-boundary safe)', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    cursor.moveTo(0);
    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moveDown from first line end responds on first key press', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    cursor.moveTo(2);
    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(5);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moveDown from empty line goes to next line start instead of preserved old x column', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 38, y: 100, width: 10, height: 20 },
        { x: 52, y: 100, width: 10, height: 20 },
        { x: 10, y: 160, width: 10, height: 20 },
        { x: 24, y: 160, width: 10, height: 20 },
        { x: 38, y: 160, width: 10, height: 20 },
        { x: 52, y: 160, width: 10, height: 20 }
      ],
      lineBreakIndices: [4, 4]
    });

    cursor.moveTo(4, 0);
    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(4);
    expect(cursor.getCursorState().lineIndex).toBe(1);

    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(4);
    expect(cursor.getCursorState().lineIndex).toBe(2);
  });

  test('moveRight from line end boundary moves to next line start (same index)', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    cursor.moveToLineEnd();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(0);

    cursor.moveRight();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moveRight from visual line end at explicit break lands on line end before moving to next line', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        // Break glyph is visible/non-zero width in some renderers.
        { x: 34, y: 100, width: 6, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    // Cursor after last visible char on first line (before break glyph).
    cursor.moveTo(2, 0);
    cursor.moveRight();

    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(0);

    cursor.moveRight();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moveRight from visual line end skips hard newline char in one step', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    cursor.moveTo(2, 0);
    cursor.moveRight();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moveRight keeps caret on trailing empty line at document end', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [2, 2, 4],
      lineLayouts: [
        { y: 100, height: 20 },
        { y: 120, height: 20 },
        { y: 140, height: 20 },
        { y: 160, height: 20 }
      ]
    });

    cursor.moveTo(4, 3);
    expect(cursor.getCursorState().lineIndex).toBe(3);

    cursor.moveRight();
    expect(cursor.getCurrentIndex()).toBe(4);
    expect(cursor.getCursorState().lineIndex).toBe(3);
  });

  test('moveLeft from first-char end lands on current line start (not previous line end)', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    cursor.moveTo(4, 1);
    expect(cursor.getCursorState().lineIndex).toBe(1);
    cursor.moveLeft();
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('moves between long and short lines by nearest x gap', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 38, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 }
    ]);
    cursor.moveTo(3);
    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(4);
    cursor.moveUp();
    expect(cursor.getCurrentIndex()).toBe(3);
  });

  test('moveDown from document start jumps to next visual line start', () => {
    const cursor = makeCursor(
      [
        { x: 70, y: 509, width: 13, height: 22 },
        { x: 151, y: 513, width: 7, height: 33 },
        { x: 159, y: 509, width: 16, height: 22 },
        { x: 70, y: 409, width: 14, height: 22 },
        { x: 90, y: 409, width: 8, height: 22 }
      ],
      4
    );

    cursor.moveTo(0);
    cursor.moveDown();
    expect(cursor.getCurrentIndex()).toBe(3);
  });

  test('respects line start and end movement', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 }
    ]);
    cursor.moveTo(2);
    cursor.moveToLineStart();
    expect(cursor.getCurrentIndex()).toBe(0);
    cursor.moveToLineEnd();
    expect(cursor.getCurrentIndex()).toBe(2);
  });
});

describe('selection', () => {
  test('supports cross-line drag and selected lines', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 },
      { x: 24, y: 140, width: 10, height: 20 }
    ]);
    cursor.setSelectionWithDirection(1, 4);
    const selection = cursor.getSelection();
    expect(selection?.start).toBe(1);
    expect(selection?.end).toBe(4);
    expect(selection?.selectedLines).toEqual([0, 1]);
  });

  test('supports backward selection', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 }
    ]);
    cursor.setSelectionWithDirection(3, 1);
    const selection = cursor.getSelection();
    expect(selection?.isBackwards).toBe(true);
    expect(selection?.start).toBe(1);
    expect(selection?.end).toBe(3);
  });

  test('select all covers entire document', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 }
    ]);
    cursor.selectAll();
    const selection = cursor.getSelection();
    expect(selection?.start).toBe(0);
    expect(selection?.end).toBe(2);
  });
});

describe('hit testing', () => {
  test('clicking next line start resolves to that line, not previous line end', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 800, height: 600 },
      charBoxes: [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 34, y: 100, width: 0, height: 20 },
        { x: 10, y: 140, width: 10, height: 20 },
        { x: 24, y: 140, width: 10, height: 20 }
      ],
      lineBreakIndices: [3]
    });

    expect(cursor.moveToClick(0, 140)).toBe(true);
    expect(cursor.getCurrentIndex()).toBe(3);
    expect(cursor.getCursorState().lineIndex).toBe(1);
  });

  test('hits nearest line in vertical gap', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 10, y: 150, width: 10, height: 20 }
    ]);
    const line = cursor.hitTestLine(126);
    expect(line).toBe(1);
  });

  test('hits nearest gap on character row', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    const idxLeft = cursor.hitTest(5, 100);
    const idxRight = cursor.hitTest(25, 100);
    expect(idxLeft).toBe(0);
    expect(idxRight).toBe(1);
  });

  test('returns -1 for clicks outside container', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    const index = cursor.hitTest(-10, -10);
    expect(index).toBe(-1);
  });
});

describe('api and events', () => {
  test('left/right collapse selection before step movement', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 38, y: 100, width: 10, height: 20 }
    ]);
    cursor.setSelection(1, 3);
    cursor.moveLeft();
    expect(cursor.getCurrentIndex()).toBe(1);
    expect(cursor.getSelection()).toBeNull();

    cursor.setSelection(0, 2);
    cursor.moveRight();
    expect(cursor.getCurrentIndex()).toBe(2);
    expect(cursor.getSelection()).toBeNull();
  });

  test('getLineInfo throws for out-of-range line', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    expect(() => cursor.getLineInfo(9)).toThrow();
  });

  test('current line info falls back when no data', () => {
    const cursor = makeCursor([]);
    const info = cursor.getCurrentLineInfo();
    expect(info.charCount).toBe(0);
    expect(info.endIndex).toBe(-1);
  });

  test('selection helpers return expected slices and offsets', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 },
      { x: 24, y: 140, width: 10, height: 20 }
    ]);
    cursor.setSelection(1, 4);
    expect(cursor.hasSelection()).toBe(true);
    expect(cursor.getSelectedCharBoxes()).toHaveLength(3);
    expect(cursor.getSelectedLines()).toEqual([
      { lineIndex: 0, startOffset: 1, endOffset: 2 },
      { lineIndex: 1, startOffset: 0, endOffset: 2 }
    ]);
    cursor.clearSelection();
    expect(cursor.hasSelection()).toBe(false);
    expect(cursor.getSelectedCharBoxes()).toEqual([]);
  });

  test('moveToClick and drag methods resolve clamped hit index', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 80, height: 80 },
      charBoxes: [
        { x: 10, y: 20, width: 10, height: 10 },
        { x: 24, y: 20, width: 10, height: 10 }
      ]
    });
    expect(cursor.moveToClick(12, 20)).toBe(true);
    expect(cursor.getCurrentIndex()).toBe(1);
    expect(cursor.moveToClick(999, 999)).toBe(false);

    cursor.moveTo(1);
    cursor.extendSelectionToClick(999, 20);
    expect(cursor.getSelection()?.end).toBe(2);
    cursor.updateSelectionDrag(-100, 20);
    expect(cursor.getSelection()?.start).toBe(0);
  });

  test('hitTest returns start index for empty content inside container', () => {
    const cursor = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: 50, height: 50 },
      charBoxes: []
    });
    expect(cursor.hitTest(10, 10)).toBe(0);
  });

  test('updateData recalculates lines and clamps selection', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 10, y: 140, width: 10, height: 20 }
    ]);
    cursor.setSelectionWithDirection(2, 3);
    cursor.updateData(
      { x: 0, y: 0, width: 200, height: 200 },
      [{ x: 10, y: 100, width: 10, height: 20 }]
    );
    expect(cursor.getLineCount()).toBe(1);
    expect(cursor.getCurrentIndex()).toBe(1);
    expect(cursor.getSelection()).toBeNull();
  });

  test('updateData accepts explicit line breaks and external line layouts', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 100, width: 10, height: 20 },
      { x: 38, y: 100, width: 10, height: 20 }
    ]);
    cursor.updateData(
      { x: 0, y: 0, width: 200, height: 200 },
      [
        { x: 10, y: 100, width: 10, height: 20 },
        { x: 24, y: 100, width: 10, height: 20 },
        { x: 38, y: 100, width: 10, height: 20 }
      ],
      [1, 2],
      [
        { y: 100, height: 20 },
        { y: 130, height: 20 },
        { y: 160, height: 20 }
      ]
    );
    expect(cursor.getLineCount()).toBe(3);
    expect(cursor.getLines()[1]?.y).toBe(130);
  });

  test('setLineTolerance emits update and changes grouping', () => {
    const cursor = makeCursor([
      { x: 10, y: 100, width: 10, height: 20 },
      { x: 24, y: 108, width: 10, height: 20 }
    ]);
    const updates: number[] = [];
    cursor.on('linesUpdate', (lines) => updates.push(lines.length));
    expect(cursor.getLineCount()).toBe(2);
    cursor.setLineTolerance(10);
    expect(cursor.getLineCount()).toBe(1);
    expect(updates.length).toBeGreaterThan(0);
  });

  test('cursor and selection events can be subscribed and removed', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    let cursorMoves = 0;
    let selectionChanges = 0;
    const onMove = () => {
      cursorMoves += 1;
    };
    const onSel = () => {
      selectionChanges += 1;
    };

    cursor.on('cursorMove', onMove);
    cursor.on('selectionChange', onSel);
    cursor.moveRight();
    cursor.setSelection(0, 1);
    expect(cursorMoves).toBeGreaterThan(0);
    expect(selectionChanges).toBeGreaterThan(0);

    cursor.off('cursorMove', onMove);
    cursor.off('selectionChange', onSel);
    const before = cursorMoves;
    cursor.moveLeft();
    expect(cursorMoves).toBe(before);
  });

  test('debug methods expose state and destroy clears internal runtime', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    cursor.enableDebug();
    const withDebug = cursor.getDebugInfo() as { debug: boolean; gaps: unknown[] };
    expect(withDebug.debug).toBe(true);
    expect(Array.isArray(withDebug.gaps)).toBe(true);
    cursor.disableDebug();
    const withoutDebug = cursor.getDebugInfo() as { debug: boolean };
    expect(withoutDebug.debug).toBe(false);
    cursor.destroy();
  });

  test('internal clamped hit path handles no-lines fallback branch', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    const internal = cursor as unknown as {
      lines: unknown[];
      hitTestClamped: (x: number, y: number) => number;
    };
    internal.lines = [];
    expect(internal.hitTestClamped(-10, 10)).toBe(0);
    expect(internal.hitTestClamped(999, 10)).toBe(1);
  });

  test('internal index mapping handles out-of-line index fallback', () => {
    const cursor = makeCursor([{ x: 10, y: 100, width: 10, height: 20 }]);
    const internal = cursor as unknown as { indexToX: (index: number, lineIndexHint?: number) => number };
    expect(internal.indexToX(3, 0)).toBe(20);
  });
});
