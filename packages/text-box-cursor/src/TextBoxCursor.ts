import {
  type Box,
  type CharBoxInput,
  type CursorEvent,
  type CursorState,
  type LineLayoutInput,
  type LineInfo,
  type SelectionState,
  type TextBoxCursorOptions,
  type VerticalAlign
} from './types';

type EventPayloads = {
  cursorMove: CursorState;
  selectionChange: SelectionState | null;
  linesUpdate: LineInfo[];
};

type Handler<T> = (data: T) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function overlapHeight(a: Box, b: Box): number {
  const top = Math.max(a.y - a.height / 2, b.y - b.height / 2);
  const bottom = Math.min(a.y + a.height / 2, b.y + b.height / 2);
  return Math.max(0, bottom - top);
}

/**
 * Stateful text-cursor logic engine.
 *
 * This class is rendering-agnostic and only computes cursor/selection state from
 * externally provided character bounding boxes.
 */
export class TextBoxCursor {
  private containerBox: Box;
  private charBoxes: Box[];
  private explicitLineBreakIndices: number[] = [];
  private explicitLineLayouts: LineLayoutInput[] = [];
  private cursorLineHint: number | null = null;
  private verticalAlign: VerticalAlign;
  private lineTolerance: number;
  private debug: boolean;
  private lines: LineInfo[] = [];
  private cursorIndex = 0;
  private selection: SelectionState | null = null;
  private dragAnchor: number | null = null;
  private preferredX: number | null = null;
  private readonly handlers: { [K in CursorEvent]: Set<Handler<EventPayloads[K]>> } = {
    cursorMove: new Set(),
    selectionChange: new Set(),
    linesUpdate: new Set()
  };

  /**
   * Creates a cursor state machine bound to a text container and character boxes.
   */
  constructor(options: TextBoxCursorOptions) {
    this.containerBox = { ...options.containerBox };
    const normalized = this.normalizeCharLayout(options.charBoxes, options.lineBreakIndices);
    this.charBoxes = normalized.charBoxes;
    this.explicitLineBreakIndices = normalized.lineBreakIndices;
    this.explicitLineLayouts = this.normalizeLineLayouts(options.lineLayouts);
    this.verticalAlign = options.verticalAlign ?? 'center';
    this.lineTolerance = options.lineTolerance ?? 5;
    this.debug = options.debug ?? false;
    this.cursorIndex = clamp(options.initialIndex ?? 0, 0, this.charBoxes.length);
    this.recomputeLines();

    if (options.initialSelection) {
      this.setSelection(options.initialSelection.start, options.initialSelection.end);
    }
  }

  /** Moves cursor one position left (or collapses existing selection to start). */
  moveLeft(): void {
    if (this.selection && !this.selection.isCollapsed) {
      this.cursorIndex = this.selection.start;
      this.cursorLineHint = null;
      this.clearSelection();
      this.emitCursor();
      return;
    }
    const currentLineIndex = this.getCurrentLineIndex();
    if (currentLineIndex >= 0) {
      const currentLine = this.lines[currentLineIndex];
      if (currentLine) {
        if (this.cursorIndex > currentLine.startIndex && this.cursorIndex <= currentLine.endIndex + 1) {
          this.moveTo(this.cursorIndex - 1, currentLineIndex);
          return;
        }
        if (this.cursorIndex === currentLine.startIndex && currentLineIndex > 0) {
          this.moveTo(this.cursorIndex, currentLineIndex - 1);
          return;
        }
      }
    }
    this.moveTo(this.cursorIndex - 1);
  }

  /** Moves cursor one position right (or collapses existing selection to end). */
  moveRight(): void {
    if (this.selection && !this.selection.isCollapsed) {
      this.cursorIndex = this.selection.end;
      this.cursorLineHint = null;
      this.clearSelection();
      this.emitCursor();
      return;
    }
    const currentLineIndex = this.getCurrentLineIndex();
    if (currentLineIndex >= 0) {
      const currentLine = this.lines[currentLineIndex];
      const nextLineIndex = currentLineIndex + 1;
      if (
        currentLine &&
        this.cursorIndex === currentLine.endIndex &&
        nextLineIndex < this.lines.length &&
        this.isHardBreakChar(currentLine.endIndex)
      ) {
        this.moveTo(currentLine.endIndex + 1, nextLineIndex);
        return;
      }
      if (
        currentLine &&
        this.cursorIndex === currentLine.endIndex + 1 &&
        nextLineIndex < this.lines.length
      ) {
        this.moveTo(this.cursorIndex, nextLineIndex);
        return;
      }
    }
    if (this.cursorIndex >= this.charBoxes.length) return;
    this.moveTo(this.cursorIndex + 1);
  }

  /** Moves cursor to nearest gap on previous detected line. */
  moveUp(): void {
    this.moveVertical(-1);
  }

  /** Moves cursor to nearest gap on next detected line. */
  moveDown(): void {
    this.moveVertical(1);
  }

  /** Moves cursor to a specific document index (clamped). */
  moveTo(index: number, lineHint: number | null = null): void {
    const next = clamp(index, 0, this.charBoxes.length);
    if (next === this.cursorIndex && this.cursorLineHint === lineHint) return;
    this.cursorIndex = next;
    this.cursorLineHint = lineHint;
    this.preferredX = null;
    this.emitCursor();
  }

  /** Moves cursor to start of document. */
  moveToStart(): void {
    this.moveTo(0);
  }

  /** Moves cursor to end of document. */
  moveToEnd(): void {
    this.moveTo(this.charBoxes.length);
  }

  /** Moves cursor to start of current line. */
  moveToLineStart(): void {
    const lineIndex = this.getCurrentLineIndex();
    if (lineIndex < 0) {
      this.moveToStart();
      return;
    }
    const line = this.lines[lineIndex];
    if (!line) return;
    this.moveTo(line.startIndex, lineIndex);
  }

  /** Moves cursor to end of current line. */
  moveToLineEnd(): void {
    const lineIndex = this.getCurrentLineIndex();
    if (lineIndex < 0) {
      this.moveToEnd();
      return;
    }
    const line = this.lines[lineIndex];
    if (!line) return;
    this.moveTo(line.endIndex + 1, lineIndex);
  }

  /** Sets selection range using normalized half-open indices `[start, end)`. */
  setSelection(start: number, end: number): void {
    const safeStart = clamp(start, 0, this.charBoxes.length);
    const safeEnd = clamp(end, 0, this.charBoxes.length);
    this.setSelectionWithDirection(safeStart, safeEnd);
  }

  /** Clears selection and keeps current cursor index. */
  clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.dragAnchor = null;
    this.emit('selectionChange', null);
  }

  /** Selects all characters in document. */
  selectAll(): void {
    this.setSelectionWithDirection(0, this.charBoxes.length);
    this.cursorIndex = this.charBoxes.length;
    this.cursorLineHint = null;
    this.emitCursor();
  }

  /** Sets directional selection endpoints (`anchor`, `active`). */
  setSelectionWithDirection(anchor: number, active: number): void {
    const safeAnchor = clamp(anchor, 0, this.charBoxes.length);
    const safeActive = clamp(active, 0, this.charBoxes.length);
    const start = Math.min(safeAnchor, safeActive);
    const end = Math.max(safeAnchor, safeActive);
    this.selection = {
      start,
      end,
      isCollapsed: start === end,
      anchor: safeAnchor,
      active: safeActive,
      isBackwards: safeActive < safeAnchor,
      selectedLines: this.resolveSelectedLines(start, end)
    };
    this.cursorIndex = safeActive;
    this.cursorLineHint = null;
    this.emit('selectionChange', this.selection);
    this.emitCursor();
  }

  /** Extends existing selection from anchor to provided index. */
  extendSelection(toIndex: number): void {
    const to = clamp(toIndex, 0, this.charBoxes.length);
    const anchor = this.selection?.anchor ?? this.cursorIndex;
    this.setSelectionWithDirection(anchor, to);
  }

  /** Returns current selection state, or `null` when no selection exists. */
  getSelection(): SelectionState | null {
    return this.selection ? { ...this.selection, selectedLines: [...this.selection.selectedLines] } : null;
  }

  /** Returns defensive copies of boxes covered by current selection. */
  getSelectedCharBoxes(): Box[] {
    if (!this.selection || this.selection.isCollapsed) return [];
    return this.charBoxes.slice(this.selection.start, this.selection.end).map((box) => ({ ...box }));
  }

  /** Returns selected segments expressed in per-line offsets. */
  getSelectedLines(): { lineIndex: number; startOffset: number; endOffset: number }[] {
    if (!this.selection || this.selection.isCollapsed) return [];
    const result: { lineIndex: number; startOffset: number; endOffset: number }[] = [];
    const { start, end } = this.selection;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;
      const lineStart = line.startIndex;
      const lineEndExclusive = line.endIndex + 1;
      const segStart = Math.max(start, lineStart);
      const segEnd = Math.min(end, lineEndExclusive);
      if (segStart < segEnd) {
        result.push({
          lineIndex: i,
          startOffset: segStart - lineStart,
          endOffset: segEnd - lineStart
        });
      }
    }
    return result;
  }

  /** Returns `true` when selection is non-collapsed. */
  hasSelection(): boolean {
    return !!this.selection && !this.selection.isCollapsed;
  }

  /** Hit-tests a click and moves cursor when successful. */
  moveToClick(clickX: number, clickY: number): boolean {
    const hit = this.hitTest(clickX, clickY);
    if (hit < 0) return false;
    const hitLineIndex = this.hitTestLine(clickY);
    this.clearSelection();
    this.moveTo(hit, hitLineIndex >= 0 ? hitLineIndex : null);
    return true;
  }

  /** Starts/extents directional selection toward clicked location. */
  extendSelectionToClick(clickX: number, clickY: number): void {
    const hit = this.hitTestClamped(clickX, clickY);
    if (hit < 0) return;
    if (this.dragAnchor === null) this.dragAnchor = this.cursorIndex;
    this.setSelectionWithDirection(this.dragAnchor, hit);
  }

  /** Updates active selection endpoint during drag interaction. */
  updateSelectionDrag(clickX: number, clickY: number): void {
    const hit = this.hitTestClamped(clickX, clickY);
    if (hit < 0) return;
    if (this.dragAnchor === null) this.dragAnchor = this.cursorIndex;
    this.setSelectionWithDirection(this.dragAnchor, hit);
  }

  /** Returns nearest cursor index for a click point, or `-1` when invalid. */
  hitTest(clickX: number, clickY: number): number {
    if (!this.isInContainer(clickX, clickY)) return -1;
    if (this.charBoxes.length === 0) return 0;
    const lineIndex = this.hitTestLine(clickY);
    if (lineIndex < 0) return -1;
    return this.closestIndexInLine(lineIndex, clickX);
  }

  /** Returns detected line index nearest to provided Y coordinate. */
  hitTestLine(clickY: number): number {
    if (this.lines.length === 0) return -1;
    let bestIndex = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;
      const top = line.y - line.height / 2;
      const bottom = line.y + line.height / 2;
      if (clickY >= top && clickY <= bottom) return i;
      const dist = clickY < top ? top - clickY : clickY - bottom;
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  /** Returns defensive snapshot of detected line metadata. */
  getLines(): LineInfo[] {
    return this.lines.map((line) => ({ ...line }));
  }

  /** Returns number of currently detected lines. */
  getLineCount(): number {
    return this.lines.length;
  }

  /** Resolves line index that contains the given cursor/character index. */
  getLineIndex(charIndex: number): number {
    if (this.lines.length === 0) return -1;
    const safe = clamp(charIndex, 0, this.charBoxes.length);
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;
      if (safe >= line.startIndex && safe <= line.endIndex + 1) {
        return i;
      }
    }
    return this.lines.length - 1;
  }

  /** Returns line info by index; throws when index is out of range. */
  getLineInfo(lineIndex: number): LineInfo {
    const line = this.lines[lineIndex];
    if (!line) {
      throw new Error(`Line index out of range: ${lineIndex}`);
    }
    return { ...line };
  }

  /** Returns line info at current cursor index. */
  getCurrentLineInfo(): LineInfo {
    const lineIndex = this.getCurrentLineIndex();
    if (lineIndex < 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        y: this.containerBox.y,
        height: this.containerBox.height,
        charCount: 0
      };
    }
    const line = this.lines[lineIndex];
    if (!line) {
      return {
        startIndex: 0,
        endIndex: -1,
        y: this.containerBox.y,
        height: this.containerBox.height,
        charCount: 0
      };
    }
    return { ...line };
  }

  /** Returns complete cursor state for rendering/inspection. */
  getCursorState(): CursorState {
    const lineIndex = this.getCurrentLineIndex();
    const position = this.getCursorPosition();
    const lineInfo: LineInfo =
      lineIndex >= 0 && this.lines[lineIndex]
        ? this.lines[lineIndex]
        : {
            startIndex: 0,
            endIndex: -1,
            y: this.containerBox.y,
            height: this.containerBox.height,
            charCount: 0
          };
    return {
      index: this.cursorIndex,
      position,
      lineIndex,
      lineInfo: { ...lineInfo },
      isAtStart: this.cursorIndex === 0,
      isAtEnd: this.cursorIndex === this.charBoxes.length,
      isAtLineStart:
        lineIndex < 0 ? true : this.cursorIndex === (this.lines[lineIndex]?.startIndex ?? this.cursorIndex),
      isAtLineEnd:
        lineIndex < 0 ? true : this.cursorIndex === (this.lines[lineIndex]?.endIndex ?? this.cursorIndex - 1) + 1
    };
  }

  /** Returns current cursor index. */
  getCurrentIndex(): number {
    return this.cursorIndex;
  }

  /** Returns current cursor pixel position derived from index and line alignment. */
  getCursorPosition(): { x: number; y: number } {
    if (this.lines.length === 0) {
      return { x: this.containerBox.x, y: this.alignY(this.containerBox.y, this.containerBox.height) };
    }

    const lineIndex = this.getCurrentLineIndex();
    const line = this.lines[Math.max(0, lineIndex)];
    if (!line) {
      return { x: this.containerBox.x, y: this.alignY(this.containerBox.y, this.containerBox.height) };
    }
    const y = this.alignY(line.y, line.height);
    const x = this.indexToX(this.cursorIndex, lineIndex);
    return { x, y };
  }

  /** Returns defensive copy of source character boxes. */
  getCharBoxes(): Box[] {
    return this.charBoxes.map((box) => ({ ...box }));
  }

  /** Returns defensive copy of container bounds. */
  getContainerBox(): Box {
    return { ...this.containerBox };
  }

  /** Replaces container/character data and recomputes line model. */
  updateData(
    containerBox: Box,
    charBoxes: CharBoxInput[],
    lineBreakIndices?: number[],
    lineLayouts?: LineLayoutInput[]
  ): void {
    this.containerBox = { ...containerBox };
    const normalized = this.normalizeCharLayout(charBoxes, lineBreakIndices);
    this.charBoxes = normalized.charBoxes;
    this.explicitLineBreakIndices = normalized.lineBreakIndices;
    this.explicitLineLayouts = this.normalizeLineLayouts(lineLayouts);
    this.recomputeLines();
    this.cursorIndex = clamp(this.cursorIndex, 0, this.charBoxes.length);
    this.cursorLineHint = null;

    if (this.selection) {
      const anchor = clamp(this.selection.anchor, 0, this.charBoxes.length);
      const active = clamp(this.selection.active, 0, this.charBoxes.length);
      if (anchor === active) {
        this.selection = null;
      } else {
        this.setSelectionWithDirection(anchor, active);
      }
    }

    this.emit('linesUpdate', this.getLines());
    this.emitCursor();
  }

  /** Updates line detection tolerance and triggers line recomputation. */
  setLineTolerance(value: number): void {
    this.lineTolerance = Math.max(0, value);
    this.recomputeLines();
    this.emit('linesUpdate', this.getLines());
    this.emitCursor();
    if (this.selection) {
      this.selection.selectedLines = this.resolveSelectedLines(this.selection.start, this.selection.end);
      this.emit('selectionChange', this.selection);
    }
  }

  /** Subscribes to cursor/selection/line update events. */
  on(event: 'cursorMove', handler: Handler<CursorState>): void;
  on(event: 'selectionChange', handler: Handler<SelectionState | null>): void;
  on(event: 'linesUpdate', handler: Handler<LineInfo[]>): void;
  on(event: CursorEvent, handler: Handler<any>): void {
    this.handlers[event].add(handler);
  }

  /** Removes previously registered event handler. */
  off(event: string, handler: (...args: unknown[]) => void): void {
    if (event === 'cursorMove' || event === 'selectionChange' || event === 'linesUpdate') {
      this.handlers[event].delete(handler as Handler<any>);
    }
  }

  /** Enables debug state collection. */
  enableDebug(): void {
    this.debug = true;
  }

  /** Disables debug state collection. */
  disableDebug(): void {
    this.debug = false;
  }

  /** Returns debug snapshot with cursor/selection/line/gap info. */
  getDebugInfo(): object {
    return {
      debug: this.debug,
      container: this.getContainerBox(),
      cursor: this.getCursorState(),
      selection: this.getSelection(),
      lines: this.getLines(),
      gaps: this.lines.map((_, lineIndex) => this.getGapPositions(lineIndex))
    };
  }

  /** Clears handlers and internal transient state. */
  destroy(): void {
    this.handlers.cursorMove.clear();
    this.handlers.selectionChange.clear();
    this.handlers.linesUpdate.clear();
    this.selection = null;
    this.dragAnchor = null;
    this.preferredX = null;
  }

  private emitCursor(): void {
    this.emit('cursorMove', this.getCursorState());
  }

  private emit<K extends CursorEvent>(event: K, payload: EventPayloads[K]): void {
    for (const handler of this.handlers[event]) handler(payload);
  }

  private moveVertical(delta: -1 | 1): void {
    const currentLineIndex = this.getCurrentLineIndex();
    if (currentLineIndex < 0) return;
    const currentLine = this.lines[currentLineIndex];
    const targetLineIndex = currentLineIndex + delta;
    if (targetLineIndex < 0 || targetLineIndex >= this.lines.length) return;

    if (this.preferredX === null || currentLine?.charCount === 0) {
      this.preferredX = this.getCursorPosition().x;
    }
    const targetIndex = this.closestIndexInLine(targetLineIndex, this.preferredX);
    this.cursorIndex = targetIndex;
    this.cursorLineHint = targetLineIndex;
    this.emitCursor();
  }

  private getCurrentLineIndex(): number {
    const raw = this.getLineIndex(this.cursorIndex);
    if (raw < 0) return raw;
    if (this.cursorLineHint === null) return raw;

    const hinted = this.lines[this.cursorLineHint];
    if (!hinted) return raw;
    if (this.cursorIndex >= hinted.startIndex && this.cursorIndex <= hinted.endIndex + 1) {
      return this.cursorLineHint;
    }
    return raw;
  }

  private isHardBreakChar(charIndex: number): boolean {
    const box = this.charBoxes[charIndex];
    if (!box) return false;
    return box.width === 0;
  }

  private resolveSelectedLines(start: number, end: number): number[] {
    if (start === end) return [];
    const lines: number[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (!line) continue;
      if (end > line.startIndex && start < line.endIndex + 1) {
        lines.push(i);
      }
    }
    return lines;
  }

  private isInContainer(x: number, y: number): boolean {
    return (
      x >= this.containerBox.x &&
      x <= this.containerBox.x + this.containerBox.width &&
      y >= this.containerBox.y &&
      y <= this.containerBox.y + this.containerBox.height
    );
  }

  private hitTestClamped(clickX: number, clickY: number): number {
    if (this.charBoxes.length === 0) return 0;
    const lineIndex = this.lines.length === 0 ? -1 : this.hitTestLine(clickY);
    if (lineIndex < 0) {
      if (clickX <= this.containerBox.x) return 0;
      if (clickX >= this.containerBox.x + this.containerBox.width) return this.charBoxes.length;
      return clamp(this.cursorIndex, 0, this.charBoxes.length);
    }
    return this.closestIndexInLine(lineIndex, clickX);
  }

  private recomputeLines(): void {
    if (this.explicitLineBreakIndices.length > 0) {
      this.lines = this.linesFromBreakIndices(
        this.charBoxes,
        this.explicitLineBreakIndices,
        this.explicitLineLayouts
      );
      return;
    }
    this.lines = this.detectLines(this.charBoxes, this.lineTolerance);
  }

  private normalizeCharLayout(
    charBoxes: CharBoxInput[],
    lineBreakIndices?: number[]
  ): { charBoxes: Box[]; lineBreakIndices: number[] } {
    const normalizedBoxes: Box[] = [];
    const inlineBreaks: number[] = [];

    for (const item of charBoxes) {
      if (!item) {
        inlineBreaks.push(normalizedBoxes.length);
        continue;
      }
      normalizedBoxes.push({ ...item });
    }

    const mergedBreaks = [...inlineBreaks, ...(lineBreakIndices ?? [])];
    const normalizedBreaks = this.normalizeBreakIndices(mergedBreaks, normalizedBoxes.length);

    return { charBoxes: normalizedBoxes, lineBreakIndices: normalizedBreaks };
  }

  private normalizeBreakIndices(indices: number[], charCount: number): number[] {
    if (indices.length === 0) return [];
    const normalized: number[] = [];
    for (const raw of indices) {
      if (!Number.isFinite(raw)) continue;
      const idx = clamp(Math.round(raw), 0, charCount);
      normalized.push(idx);
    }
    return normalized.sort((a, b) => a - b);
  }

  private normalizeLineLayouts(lineLayouts?: LineLayoutInput[]): LineLayoutInput[] {
    if (!lineLayouts || lineLayouts.length === 0) return [];
    const normalized: LineLayoutInput[] = [];
    for (const line of lineLayouts) {
      if (!line) continue;
      if (!Number.isFinite(line.y) || !Number.isFinite(line.height)) continue;
      normalized.push({ y: line.y, height: Math.max(1, line.height) });
    }
    return normalized;
  }

  private linesFromBreakIndices(
    charBoxes: Box[],
    lineBreakIndices: number[],
    lineLayouts: LineLayoutInput[]
  ): LineInfo[] {
    if (charBoxes.length === 0 && lineBreakIndices.length === 0) return [];
    if (lineBreakIndices.length === 0) return this.detectLines(charBoxes, this.lineTolerance);

    const lines: LineInfo[] = [];
    let start = 0;
    for (const breakIndex of lineBreakIndices) {
      if (breakIndex < start || breakIndex > charBoxes.length) continue;
      if (breakIndex === start) {
        lines.push(this.createEmptyLine(start, lines[lines.length - 1], lineLayouts[lines.length]));
        continue;
      }
      lines.push(this.withLineLayout(this.aggregateLine(charBoxes, start, breakIndex - 1), lineLayouts[lines.length]));
      start = breakIndex;
    }

    if (start < charBoxes.length) {
      lines.push(this.withLineLayout(this.aggregateLine(charBoxes, start, charBoxes.length - 1), lineLayouts[lines.length]));
    } else {
      lines.push(this.createEmptyLine(start, lines[lines.length - 1], lineLayouts[lines.length]));
    }

    return lines;
  }

  private detectLines(charBoxes: Box[], tolerance: number): LineInfo[] {
    if (charBoxes.length === 0) return [];
    const lines: LineInfo[] = [];
    const overlapRatioThreshold = 0.65;
    let start = 0;

    for (let i = 1; i < charBoxes.length; i++) {
      const prev = charBoxes[i - 1];
      const curr = charBoxes[i];
      if (!prev || !curr) continue;
      const yDiff = Math.abs(curr.y - prev.y);
      const xReset = curr.x + tolerance < prev.x;
      const verticalOverlap = overlapHeight(prev, curr);
      const minimumHeight = Math.min(prev.height, curr.height);
      const overlapRatio = minimumHeight > 0 ? verticalOverlap / minimumHeight : 0;
      const lowOverlap = overlapRatio < overlapRatioThreshold;
      const isBreak = xReset || (yDiff > tolerance && lowOverlap);

      if (isBreak) {
        lines.push(this.aggregateLine(charBoxes, start, i - 1));
        start = i;
      }
    }

    lines.push(this.aggregateLine(charBoxes, start, charBoxes.length - 1));

    return lines;
  }

  private aggregateLine(charBoxes: Box[], startIndex: number, endIndex: number): LineInfo {
    let ySum = 0;
    let count = 0;
    let maxHeight = 0;

    for (let i = startIndex; i <= endIndex; i++) {
      const box = charBoxes[i];
      if (!box) continue;
      ySum += box.y;
      count += 1;
      maxHeight = Math.max(maxHeight, box.height);
    }

    if (count === 0) {
      return {
        startIndex,
        endIndex,
        y: this.containerBox.y,
        height: this.containerBox.height,
        charCount: Math.max(0, endIndex - startIndex + 1)
      };
    }

    return {
      startIndex,
      endIndex,
      y: ySum / count,
      height: maxHeight,
      charCount: endIndex - startIndex + 1
    };
  }

  private withLineLayout(line: LineInfo, lineLayout?: LineLayoutInput): LineInfo {
    if (!lineLayout) return line;
    return {
      ...line,
      y: lineLayout.y,
      height: Math.max(1, lineLayout.height)
    };
  }

  private createEmptyLine(index: number, previousLine?: LineInfo, lineLayout?: LineLayoutInput): LineInfo {
    if (lineLayout) {
      return {
        startIndex: index,
        endIndex: index - 1,
        y: lineLayout.y,
        height: Math.max(1, lineLayout.height),
        charCount: 0
      };
    }
    const fallbackHeight = Math.max(1, previousLine?.height ?? this.containerBox.height);
    const fallbackY =
      previousLine !== undefined
        ? previousLine.y + fallbackHeight
        : this.alignY(this.containerBox.y, this.containerBox.height);
    return {
      startIndex: index,
      endIndex: index - 1,
      y: fallbackY,
      height: fallbackHeight,
      charCount: 0
    };
  }

  private alignY(lineY: number, lineHeight: number): number {
    if (this.verticalAlign === 'top') return lineY - lineHeight / 2;
    if (this.verticalAlign === 'bottom') return lineY + lineHeight / 2;
    return lineY;
  }

  private indexToX(index: number, lineIndexHint?: number): number {
    if (this.charBoxes.length === 0) return this.containerBox.x;
    if (index <= 0) return this.containerBox.x;

    const lineIndex = lineIndexHint ?? this.getLineIndex(index);
    if (lineIndex < 0) return this.containerBox.x;
    const line = this.lines[lineIndex];
    if (!line) return this.containerBox.x;

    if (index <= line.startIndex) return this.containerBox.x;
    if (index > line.endIndex + 1) {
      const last = this.charBoxes[this.charBoxes.length - 1];
      if (!last) return this.containerBox.x;
      return last.x + last.width;
    }

    const box = this.charBoxes[index - 1];
    if (!box) return this.containerBox.x;
    return box.x + box.width;
  }

  private getGapPositions(lineIndex: number): { index: number; x: number }[] {
    const line = this.lines[lineIndex];
    if (!line) return [];
    const positions: { index: number; x: number }[] = [{ index: line.startIndex, x: this.containerBox.x }];
    for (let i = line.startIndex; i <= line.endIndex; i++) {
      const box = this.charBoxes[i];
      if (!box) continue;
      positions.push({ index: i + 1, x: box.x + box.width });
    }
    return positions;
  }

  private closestIndexInLine(lineIndex: number, x: number): number {
    const gaps = this.getGapPositions(lineIndex);
    if (gaps.length === 0) return 0;

    let best = gaps[0]!;
    let bestDist = Math.abs(x - best.x);
    for (let i = 1; i < gaps.length; i++) {
      const candidate = gaps[i];
      if (!candidate) continue;
      const dist = Math.abs(x - candidate.x);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return best.index;
  }
}
