import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@mlightcad/text-box-cursor', () => {
  class TextBoxCursor {}
  class CursorRenderer {}
  class ThreeJsRendererAdapter {}
  return {
    TextBoxCursor,
    CursorRenderer,
    ThreeJsRendererAdapter
  };
});

vi.mock('@mlightcad/mtext-renderer', () => {
  class UnifiedRenderer {}
  return {
    getColorByIndex: () => 0xffffff,
    UnifiedRenderer,
    MTextAttachmentPoint: { TopLeft: 1 },
    MTextFlowDirection: { LEFT_TO_RIGHT: 1 }
  };
});

vi.mock('@mlightcad/mtext-renderer', () => {
  class MTextContext {}
  return {
    MTextContext,
    MTextLineAlignment: {
      TOP: 1,
      MIDDLE: 2,
      BOTTOM: 3
    }
  };
});

let MTextInputBox: any;

beforeAll(async () => {
  ({ MTextInputBox } = await import('../src/viewer/viewer'));
});

type AstNode =
  | { type: 'char'; value: string }
  | { type: 'stack'; numerator: string; denominator: string; divider: string }
  | { type: 'paragraphBreak' }
  | { type: 'columnBreak' }
  | { type: 'wrapAtDimLine' };

function makeMappingContext(nodes: AstNode[]) {
  const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
  const context = {
    document: { ast: { nodes } },
    charCount: () => nodes.filter((node) => node.type === 'char' || node.type === 'stack').length,
    getNodeLogicalSpan: proto.getNodeLogicalSpan
  };
  return { context, proto };
}

describe('MTextInputBox cursor/document index mapping', () => {
  test('maps same logical boundary to current empty line by lineIndexHint', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'char', value: 'B' },
      { type: 'paragraphBreak' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'C' }
    ];
    const { context, proto } = makeMappingContext(nodes);

    const toDocumentIndexFromLogicalIndex = proto.toDocumentIndexFromLogicalIndex as (
      this: any,
      logicalIndex: number,
      preferAfterZeroSpan?: boolean,
      lineIndexHint?: number
    ) => number;

    // Same logical index exists at multiple document boundaries around consecutive breaks.
    expect(toDocumentIndexFromLogicalIndex.call(context, 2, true, 0)).toBe(2);
    expect(toDocumentIndexFromLogicalIndex.call(context, 2, true, 1)).toBe(3);
    expect(toDocumentIndexFromLogicalIndex.call(context, 2, true, 2)).toBe(4);
  });

  test('falls back to last candidate for collapsed cursor when no line hint', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'paragraphBreak' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'B' }
    ];
    const { context, proto } = makeMappingContext(nodes);

    const toDocumentIndexFromLogicalIndex = proto.toDocumentIndexFromLogicalIndex as (
      this: any,
      logicalIndex: number,
      preferAfterZeroSpan?: boolean
    ) => number;

    expect(toDocumentIndexFromLogicalIndex.call(context, 1, true)).toBe(3);
    expect(toDocumentIndexFromLogicalIndex.call(context, 1, false)).toBe(1);
  });

  test('syncDocumentFromUiState uses cursor line hint for collapsed selection', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'char', value: 'B' },
      { type: 'paragraphBreak' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'C' }
    ];
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const document = {
      ast: { nodes },
      cursor: 0,
      setSelection: vi.fn(),
      clearSelection: vi.fn()
    };

    const context = {
      document,
      cursorIndex: 2,
      getSelectionRange: () => ({ start: 2, end: 2, isCollapsed: true }),
      charCount: () => nodes.filter((node) => node.type === 'char' || node.type === 'stack').length,
      getNodeLogicalSpan: proto.getNodeLogicalSpan,
      toDocumentIndexFromLogicalIndex: proto.toDocumentIndexFromLogicalIndex,
      cursorLogic: {
        getCursorState: () => ({ lineIndex: 1 })
      }
    };

    const syncDocumentFromUiState = proto.syncDocumentFromUiState as (this: any) => void;
    syncDocumentFromUiState.call(context);

    expect(document.clearSelection).toHaveBeenCalledTimes(1);
    expect(document.cursor).toBe(3);
  });

  test('syncDocumentFromUiState prefers boundary before zero-span when caret is at visual line end', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'char', value: 'B' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'C' }
    ];
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const document = {
      ast: { nodes },
      cursor: 0,
      setSelection: vi.fn(),
      clearSelection: vi.fn()
    };

    const context = {
      document,
      cursorIndex: 2,
      getSelectionRange: () => ({ start: 2, end: 2, isCollapsed: true }),
      charCount: () => nodes.filter((node) => node.type === 'char' || node.type === 'stack').length,
      getNodeLogicalSpan: proto.getNodeLogicalSpan,
      toDocumentIndexFromLogicalIndex: proto.toDocumentIndexFromLogicalIndex,
      cursorLogic: {
        getCursorState: () => ({ lineIndex: 99, isAtLineStart: false, isAtLineEnd: true })
      }
    };

    const syncDocumentFromUiState = proto.syncDocumentFromUiState as (this: any) => void;
    syncDocumentFromUiState.call(context);

    // logical index=2 has two boundaries: before paragraph break (2) and after it (3).
    // At line end we should insert before break.
    expect(document.cursor).toBe(2);
  });

  test('syncDocumentFromUiState prefers boundary after zero-span when caret is at visual line start', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'char', value: 'B' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'C' }
    ];
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const document = {
      ast: { nodes },
      cursor: 0,
      setSelection: vi.fn(),
      clearSelection: vi.fn()
    };

    const context = {
      document,
      cursorIndex: 2,
      getSelectionRange: () => ({ start: 2, end: 2, isCollapsed: true }),
      charCount: () => nodes.filter((node) => node.type === 'char' || node.type === 'stack').length,
      getNodeLogicalSpan: proto.getNodeLogicalSpan,
      toDocumentIndexFromLogicalIndex: proto.toDocumentIndexFromLogicalIndex,
      cursorLogic: {
        getCursorState: () => ({ lineIndex: 99, isAtLineStart: true, isAtLineEnd: false })
      }
    };

    const syncDocumentFromUiState = proto.syncDocumentFromUiState as (this: any) => void;
    syncDocumentFromUiState.call(context);

    expect(document.cursor).toBe(3);
  });

  test('syncDocumentFromUiState resolves visual wrapped line-end to pre-break candidate', () => {
    const nodes: AstNode[] = [
      { type: 'char', value: 'A' },
      { type: 'char', value: 'B' },
      { type: 'char', value: 'C' },
      { type: 'paragraphBreak' },
      { type: 'paragraphBreak' },
      { type: 'char', value: 'D' }
    ];
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const document = {
      ast: { nodes },
      cursor: 0,
      setSelection: vi.fn(),
      clearSelection: vi.fn()
    };

    const context = {
      document,
      cursorIndex: 3,
      getSelectionRange: () => ({ start: 3, end: 3, isCollapsed: true }),
      charCount: () => nodes.filter((node) => node.type === 'char' || node.type === 'stack').length,
      getNodeLogicalSpan: proto.getNodeLogicalSpan,
      toDocumentIndexFromLogicalIndex: proto.toDocumentIndexFromLogicalIndex,
      resolveCandidateByVisualLineHint: proto.resolveCandidateByVisualLineHint,
      cursorLogic: {
        getCursorState: () => ({ lineIndex: 1, isAtLineStart: false, isAtLineEnd: true }),
        // visual lines around logical index=3 are [2,3,4]:
        // 1 => wrapped paragraph last line end, 2 => empty line (\P), 3 => next paragraph start.
        getLines: () => [
          { startIndex: 0, endIndex: 0, charCount: 1, y: 0, height: 10 },
          { startIndex: 1, endIndex: 2, charCount: 2, y: -10, height: 10 },
          { startIndex: 3, endIndex: 2, charCount: 0, y: -20, height: 10 },
          { startIndex: 3, endIndex: 3, charCount: 1, y: -30, height: 10 }
        ]
      }
    };

    const syncDocumentFromUiState = proto.syncDocumentFromUiState as (this: any) => void;
    syncDocumentFromUiState.call(context);

    expect(document.cursor).toBe(3);
  });

  test('extracts cursor data from object.createLayoutData instead of legacy charBoxes', () => {
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const context = {
      position: { x: 10, y: 20 },
      width: 120,
      getFallbackLineAdvance: () => 16,
      toLocalBox: proto.toLocalBox
    };

    const object = {
      box: new THREE.Box3(new THREE.Vector3(10, 14, 0), new THREE.Vector3(70, 30, 0)),
      createLayoutData: () => ({
        chars: [
          {
            type: 'CHAR',
            box: new THREE.Box3(new THREE.Vector3(10, 20, 0), new THREE.Vector3(20, 30, 0)),
            char: 'A',
            children: []
          },
          {
            type: 'CHAR',
            box: new THREE.Box3(new THREE.Vector3(10, 6, 0), new THREE.Vector3(18, 16, 0)),
            char: 'B',
            children: []
          }
        ],
        lines: [
          { y: 25, height: 10, breakIndex: 1 },
          { y: 11, height: 10, breakIndex: undefined }
        ]
      })
    };

    const extractBoxesFromRenderedObject = proto.extractBoxesFromRenderedObject as (
      this: any,
      obj: any
    ) => {
      containerBox: { x: number; y: number; width: number; height: number };
      charBoxes: Array<{ x: number; y: number; width: number; height: number }>;
      lineBreakIndices?: number[];
      lineLayouts?: Array<{ y: number; height: number }>;
    };

    const result = extractBoxesFromRenderedObject.call(context, object);

    expect(result.charBoxes).toHaveLength(2);
    expect(result.lineBreakIndices).toEqual([1]);
    expect(result.lineLayouts).toEqual([
      { y: 5, height: 10 },
      { y: -9, height: 10 }
    ]);
    expect(result.containerBox).toEqual({
      x: 0,
      y: -14,
      width: 120,
      height: 24
    });
  });

  test('anchors empty-content cursor to first line center from container top', () => {
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const getActiveCursorRenderState = proto.getActiveCursorRenderState as (
      this: any,
      fallbackPosition: { x: number; y: number },
      fallbackHeight: number
    ) => { position: { x: number; y: number }; height: number };

    const context = {
      cursorLogic: {
        getCharBoxes: () => [],
        getCurrentIndex: () => 0,
        getCurrentLineInfo: () => ({ startIndex: 0, endIndex: -1, charCount: 0, y: 220, height: 220 })
      },
      latestCursorLayoutData: { containerBox: { x: 0, y: 200, width: 300, height: 220 }, charBoxes: [] },
      layoutContainer: { x: 0, y: 200, width: 300, height: 220 },
      getFallbackLineAdvance: () => 24
    };

    const result = getActiveCursorRenderState.call(context, { x: 0, y: 220 }, 220);

    expect(result.position).toEqual({ x: 0, y: 212 });
    expect(result.height).toBeCloseTo(19.2);
  });

  test('handleKeyDown closes editor on Escape', () => {
    const proto = MTextInputBox.prototype as unknown as Record<string, (...args: any[]) => any>;
    const handleKeyDown = proto.handleKeyDown as (this: any, event: KeyboardEvent) => boolean;
    const closeEditor = vi.fn();

    const consumed = handleKeyDown.call(
      {
        closeEditor
      },
      { key: 'Escape', isComposing: false } as KeyboardEvent
    );

    expect(consumed).toBe(true);
    expect(closeEditor).toHaveBeenCalledTimes(1);
  });
});
