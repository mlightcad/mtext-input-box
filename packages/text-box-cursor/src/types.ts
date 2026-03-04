/**
 * Axis-aligned rectangle in screen-space pixels.
 *
 * Coordinate system:
 * - Origin is top-left.
 * - Positive `x` points right.
 * - Positive `y` points down.
 *
 * Units:
 * - All values are pixel-like numeric units in the same coordinate space.
 */
export interface Box {
  /** Left edge X coordinate. */
  x: number;
  /** Top edge Y coordinate. */
  y: number;
  /** Box width (should be non-negative). */
  width: number;
  /** Box height (should be non-negative). */
  height: number;
}

/**
 * Input item used by cursor layout updates.
 *
 * Variants:
 * - `Box`: one rendered character (or glyph cluster) bounds.
 * - `null` / `undefined`: inline line-break marker (legacy compatibility).
 *
 * Notes:
 * - Inline break markers are converted into explicit break indices internally.
 * - Prefer `lineBreakIndices` for deterministic, explicit line control.
 */
export type CharBoxInput = Box | null | undefined;

/**
 * Computed visual line metadata used by cursor movement, hit-testing, and rendering.
 *
 * Index semantics:
 * - Character ranges are inclusive: `[startIndex, endIndex]`.
 * - Cursor gaps are boundary indices in `[0, charCount]`, where line end gap is `endIndex + 1`.
 */
export interface LineInfo {
  /** Inclusive first character index on this line. */
  startIndex: number;
  /**
   * Inclusive last character index on this line.
   * May be `startIndex - 1` for an empty line.
   */
  endIndex: number;
  /** Line center Y used for cursor placement and vertical hit-testing. */
  y: number;
  /** Effective line height used for cursor size and hit area. */
  height: number;
  /** Number of characters in the line (`0` for empty lines). */
  charCount: number;
}

/**
 * External per-line layout supplied by your text engine.
 *
 * This lets `TextBoxCursor` use authoritative line geometry instead of inferred fallbacks,
 * especially important when there are explicit empty lines.
 */
export interface LineLayoutInput {
  /** Line center Y used for cursor placement and hit-testing. */
  y: number;
  /** Line height used for cursor size and vertical hit area. */
  height: number;
}

/**
 * Vertical anchor strategy for cursor Y placement relative to line box.
 *
 * - `'top'`: cursor Y is at line top edge.
 * - `'center'`: cursor Y is at line center.
 * - `'bottom'`: cursor Y is at line bottom edge.
 */
export type VerticalAlign = 'top' | 'center' | 'bottom';

/**
 * Normalized half-open selection range `[start, end)`.
 *
 * The range is clamped into `[0, totalCharCount]`.
 */
export interface SelectionRange {
  /** Inclusive start boundary index. */
  start: number;
  /** Exclusive end boundary index. */
  end: number;
  /** Convenience flag equal to `start === end`. */
  isCollapsed: boolean;
}

/**
 * Full selection state including directionality and affected lines.
 *
 * `SelectionState` extends normalized range semantics from `SelectionRange`.
 */
export interface SelectionState extends SelectionRange {
  /** Fixed boundary index where selection started. */
  anchor: number;
  /** Moving boundary index where selection currently ends. */
  active: number;
  /** `true` when `active < anchor` (selection dragged backwards). */
  isBackwards: boolean;
  /** Visual line indices touched by current selection. */
  selectedLines: number[];
}

/**
 * Fully resolved cursor state for rendering and UI display.
 */
export interface CursorState {
  /** Current caret boundary index in `[0, totalCharCount]`. */
  index: number;
  /** Pixel position where caret should be drawn. */
  position: { x: number; y: number };
  /**
   * Current visual line index.
   * `-1` indicates no resolved line (for example, empty document).
   */
  lineIndex: number;
  /** Resolved current line metadata used to render the caret. */
  lineInfo: LineInfo;
  /** `true` when `index === 0`. */
  isAtStart: boolean;
  /** `true` when `index === totalCharCount`. */
  isAtEnd: boolean;
  /** `true` when caret is at current line start boundary. */
  isAtLineStart: boolean;
  /** `true` when caret is at current line end boundary (`endIndex + 1`). */
  isAtLineEnd: boolean;
}

/**
 * Constructor options for `TextBoxCursor`.
 *
 * Design boundary (important):
 * - `TextBoxCursor` is content-agnostic. It does not read or interpret actual character text.
 *   It only consumes per-character geometry (`charBoxes`) and computes caret/selection from boxes.
 * - `TextBoxCursor` is paragraph-agnostic. It does not model paragraph semantics.
 *   It only operates on visual lines (line ranges, line `y`, line `height`), regardless of
 *   how those lines are produced by your editor/layout engine.
 */
export interface TextBoxCursorOptions {
  /** Editable text container bounds used for hit-testing and fallbacks. */
  containerBox: Box;
  /**
   * Character boxes in logical text order.
   *
   * Each item maps to one logical character/glyph box. `null`/`undefined` can be used
   * as legacy inline line-break markers.
   *
   * Note:
   * - The cursor engine only uses box geometry (`x/y/width/height`).
   * - It does not require the actual character string.
   */
  charBoxes: CharBoxInput[];
  /**
   * Optional explicit line breaks as half-open character indices.
   * Index `i` means a break between character `i - 1` and `i`.
   *
   * This is a visual line boundary input, not a paragraph model.
   * If your editor has paragraph structure, convert it to line boundaries before passing here.
   *
   * Relationship with `lineLayouts`:
   * - If you also provide `lineLayouts`, the expected count is
   *   `lineBreakIndices.length + 1` (one layout per resulting visual line).
   * - Duplicated break indices still create extra lines (empty lines), so they
   *   also require corresponding `lineLayouts` entries.
   *
   * Notes:
   * - Duplicated indices are meaningful and represent empty lines.
   * - `0` and `charCount` are allowed (leading/trailing empty lines).
   *
   * Examples (`charCount = 4`):
   * - `[2]` => lines: `[0..1]`, `[2..3]`
   * - `[2, 2]` => lines: `[0..1]`, `empty`, `[2..3]`
   * - `[0, 2, 4]` => lines: `empty`, `[0..1]`, `[2..3]`, `empty`
  */
  lineBreakIndices?: number[];
  /**
   * Optional line layout metadata in visual line order.
   *
   * Effective only when `lineBreakIndices` is provided.
   * This describes visual line geometry only (line `y`/`height`), not paragraph metadata.
   *
   * Count rule:
   * - Expected: `lineLayouts.length === lineBreakIndices.length + 1`.
   * - If fewer entries are provided, missing lines fall back to internal
   *   estimated `y/height`.
   * - If extra entries are provided, extras are ignored.
   *
   * When count matches, each resulting line (including empty lines) uses the
   * corresponding `y/height` in visual line order.
   */
  lineLayouts?: LineLayoutInput[];
  /**
   * Initial caret boundary index.
   *
   * Defaults to `0`. Values outside range are clamped to `[0, totalCharCount]`.
   */
  initialIndex?: number;
  /**
   * Optional initial selection.
   *
   * Selection is normalized/clamped during initialization.
   */
  initialSelection?: SelectionRange;
  /**
   * Vertical anchor used to convert line box to caret Y coordinate.
   *
   * Defaults to `'center'`.
   */
  verticalAlign?: VerticalAlign;
  /**
   * Y/X-break tolerance used only when lines are inferred from geometry
   * (that is, when `lineBreakIndices` is not provided).
   *
   * Larger values merge nearby rows more aggressively.
   */
  lineTolerance?: number;
  /**
   * Enables extra internal debug snapshot data.
   *
   * Defaults to `false`.
   */
  debug?: boolean;
}

/**
 * Event names emitted by `TextBoxCursor`.
 *
 * - `'cursorMove'`: emitted after caret index/position changes.
 * - `'selectionChange'`: emitted after selection state changes.
 * - `'linesUpdate'`: emitted after line model recomputation.
 */
export type CursorEvent = 'cursorMove' | 'selectionChange' | 'linesUpdate';
