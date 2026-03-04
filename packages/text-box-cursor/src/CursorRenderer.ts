import type { Box } from './types';
import type {
  CursorRendererOptions,
  CursorStyle,
  DebugVisibility,
  DebugData,
  DebugStyle,
  SelectionStyle,
  Transform
} from './renderer/types';

const DEFAULT_CURSOR_STYLE: CursorStyle = {
  width: 4,
  height: 24,
  heightMode: 'lineHeight',
  color: '#00f5ff',
  glowColor: '#00f5ff',
  glowIntensity: 0.9,
  blinkSpeed: 1.05,
  blinkEnabled: true,
  billboard: true,
  depthTest: false,
  renderOrder: 100,
  mode: 'plane'
};

const DEFAULT_SELECTION_STYLE: SelectionStyle = {
  fillColor: 'rgba(0,120,255,0.30)',
  blendMode: 'normal',
  animate: false,
  strategy: 'perChar'
};

const DEFAULT_DEBUG_STYLE: DebugStyle = {
  charBoxColor: 'rgba(64,160,255,0.55)',
  charBoxFill: 'rgba(64,160,255,0.10)',
  charIndexColor: 'rgba(255,255,255,0.85)',
  rowHoverColor: 'rgba(200,200,200,0.10)',
  rowBoundaryColor: 'rgba(255,255,255,0.22)',
  gapColor: 'rgba(255,153,0,0.7)',
  baselineColor: 'rgba(255,51,51,0.55)',
  containerColor: 'rgba(255,255,255,0.30)'
};

const DEFAULT_DEBUG_VISIBILITY: DebugVisibility = {
  showCharBoxes: true,
  showLineIndices: true,
  showCharIndices: true,
  showChars: true
};

/**
 * Rendering orchestrator for cursor/selection/debug overlays.
 *
 * Consumes precomputed state from `TextBoxCursor` and forwards primitive draw
 * instructions to an `I3DRenderer` adapter.
 */
export class CursorRenderer {
  private readonly renderer: CursorRendererOptions['renderer'];
  private cursorStyle: CursorStyle;
  private selectionStyle: SelectionStyle;
  private debugStyle: DebugStyle;
  private debugVisibility: DebugVisibility;
  private enableSelection: boolean;
  private enableDebug: boolean;
  private readonly debugYAxisUp: boolean;
  private visible = true;

  private cursorState: { position: { x: number; y: number; z?: number }; lineHeight: number } | null = null;
  private selectionBoxes: Box[] = [];
  private debugData: DebugData | null = null;
  private viewTransform: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

  /** Creates a renderer with adapter backend and style toggles. */
  constructor(options: CursorRendererOptions) {
    this.renderer = options.renderer;
    this.cursorStyle = { ...DEFAULT_CURSOR_STYLE, ...options.cursorStyle };
    this.selectionStyle = { ...DEFAULT_SELECTION_STYLE, ...options.selectionStyle };
    this.debugStyle = { ...DEFAULT_DEBUG_STYLE, ...options.debugStyle };
    this.debugVisibility = { ...DEFAULT_DEBUG_VISIBILITY, ...options.debugVisibility };
    this.enableSelection = options.enableSelection ?? true;
    this.enableDebug = options.enableDebug ?? false;
    this.debugYAxisUp = options.debugYAxisUp ?? false;
  }

  /** Updates current cursor world/screen position and line height. */
  updateCursor(position: { x: number; y: number; z?: number }, lineHeight: number): void {
    this.cursorState = { position, lineHeight };
  }

  /** Updates selected character boxes rendered as highlight overlays. */
  updateSelection(selectedBoxes: Box[]): void {
    this.selectionBoxes = selectedBoxes.map((box) => ({ ...box }));
  }

  /** Updates debug visualization payload. */
  updateDebugInfo(debugData: DebugData): void {
    const next: DebugData = {
      containerBox: { ...debugData.containerBox },
      charBoxes: debugData.charBoxes.map((box) => ({ ...box })),
      lines: debugData.lines.map((line) => ({ ...line }))
    };
    if (debugData.chars) next.chars = [...debugData.chars];
    if (debugData.gapPositions) next.gapPositions = [...debugData.gapPositions];
    if (debugData.hoverLineIndex !== undefined) next.hoverLineIndex = debugData.hoverLineIndex;
    this.debugData = next;
  }

  /** Partially overrides current cursor style. */
  setCursorStyle(style: Partial<CursorStyle>): void {
    this.cursorStyle = { ...this.cursorStyle, ...style };
  }

  /** Partially overrides current selection style. */
  setSelectionStyle(style: Partial<SelectionStyle>): void {
    this.selectionStyle = { ...this.selectionStyle, ...style };
  }

  /** Enables/disables debug overlay rendering. */
  setDebugMode(enabled: boolean): void {
    this.enableDebug = enabled;
  }

  /** Partially overrides visibility of debug sub-layers. */
  setDebugVisibility(visibility: Partial<DebugVisibility>): void {
    this.debugVisibility = { ...this.debugVisibility, ...visibility };
  }

  /** Sets view transform used for zoom/pan rendering. */
  setViewTransform(transform: Partial<Transform>): void {
    this.viewTransform = { ...this.viewTransform, ...transform };
  }

  /** Marks renderer output visible. */
  show(): void {
    this.visible = true;
  }

  /** Marks renderer output hidden. */
  hide(): void {
    this.visible = false;
  }

  /** Toggles renderer visibility. */
  toggle(): void {
    this.visible = !this.visible;
  }

  /** Renders one frame using latest pushed state. */
  render(): void {
    this.renderer.beginFrame();

    if (!this.visible) {
      this.renderer.endFrame();
      return;
    }

    this.renderer.setTransform({
      x: this.viewTransform.x ?? 0,
      y: this.viewTransform.y ?? 0,
      scaleX: this.viewTransform.scaleX ?? 1,
      scaleY: this.viewTransform.scaleY ?? 1,
      rotation: this.viewTransform.rotation ?? 0
    });

    if (this.enableDebug && this.debugData) this.drawDebug(this.debugData);
    if (this.enableSelection && this.selectionBoxes.length > 0) this.drawSelection(this.selectionBoxes);
    if (this.cursorState) this.drawCursor(this.cursorState.position, this.cursorState.lineHeight);

    this.renderer.resetTransform();
    this.renderer.endFrame();
  }

  /** Releases adapter resources and clears cached render state. */
  dispose(): void {
    this.renderer.destroy();
    this.selectionBoxes = [];
    this.cursorState = null;
    this.debugData = null;
  }

  private drawCursor(position: { x: number; y: number }, lineHeight: number): void {
    const blinkPeriodMs = Math.max(0.2, this.cursorStyle.blinkSpeed) * 1000;
    const blinkOn = !this.cursorStyle.blinkEnabled || Date.now() % blinkPeriodMs < blinkPeriodMs / 2;
    if (!blinkOn) return;

    const height =
      this.cursorStyle.heightMode === 'fixed'
        ? this.cursorStyle.height
        : Math.max(this.cursorStyle.height, lineHeight * 0.8);

    if (this.cursorStyle.glowColor && (this.cursorStyle.glowIntensity ?? 0) > 0) {
      this.renderer.drawLine({
        x1: position.x,
        y1: position.y - height / 2,
        x2: position.x,
        y2: position.y + height / 2,
        color: this.cursorStyle.glowColor,
        width: this.cursorStyle.width + 2,
        opacity: Math.min(1, this.cursorStyle.glowIntensity ?? 0)
      });
    }

    this.renderer.drawLine({
      x1: position.x,
      y1: position.y - height / 2,
      x2: position.x,
      y2: position.y + height / 2,
      color: this.cursorStyle.color,
      width: this.cursorStyle.width,
      opacity: 1
    });
  }

  private drawSelection(boxes: Box[]): void {
    if (this.selectionStyle.strategy === 'merged') {
      this.mergeBoxes(boxes).forEach((box) => this.drawSelectionQuad(box));
      return;
    }
    boxes.forEach((box) => this.drawSelectionQuad(box));
  }

  private drawSelectionQuad(box: Box): void {
    const quad = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fillColor: this.selectionStyle.fillColor,
      blendMode:
        this.selectionStyle.blendMode === 'additive'
          ? 'lighter'
          : this.selectionStyle.blendMode === 'multiply'
            ? 'multiply'
            : 'source-over'
    } as const;

    this.renderer.drawQuad({
      ...quad,
      ...(this.selectionStyle.borderColor ? { borderColor: this.selectionStyle.borderColor } : {}),
      ...(this.selectionStyle.borderWidth !== undefined
        ? { borderWidth: this.selectionStyle.borderWidth }
        : {}),
      ...(this.selectionStyle.cornerRadius !== undefined
        ? { cornerRadius: this.selectionStyle.cornerRadius }
        : {})
    });
  }

  private drawDebug(data: DebugData): void {
    this.renderer.drawBox({
      box: {
        x: data.containerBox.x,
        y: data.containerBox.y + data.containerBox.height / 2,
        width: data.containerBox.width,
        height: data.containerBox.height
      },
      color: this.debugStyle.containerColor,
      opacity: 1,
      lineWidth: 1
    });

    const right = data.containerBox.x + data.containerBox.width + 60;

    data.lines.forEach((line, lineIndex) => {
      const top = this.debugYAxisUp ? line.y + line.height / 2 : line.y - line.height / 2;
      const bottom = this.debugYAxisUp ? line.y - line.height / 2 : line.y + line.height / 2;

      if (data.hoverLineIndex === lineIndex) {
        this.renderer.drawQuad({
          x: 0,
          y: line.y,
          width: right,
          height: line.height,
          fillColor: this.debugStyle.rowHoverColor
        });
      }

      this.renderer.drawLine({
        x1: 0,
        y1: top,
        x2: right,
        y2: top,
        color: this.debugStyle.rowBoundaryColor,
        dashed: [5, 5]
      });
      this.renderer.drawLine({
        x1: 0,
        y1: bottom,
        x2: right,
        y2: bottom,
        color: this.debugStyle.rowBoundaryColor,
        dashed: [5, 5]
      });
      if (this.debugVisibility.showLineIndices) {
        this.renderer.drawText({
          text: `L${lineIndex}`,
          x: 8,
          y: top + (this.debugYAxisUp ? -2 : 2),
          color: 'rgba(255,255,255,0.65)',
          font: '12px monospace'
        });
      }
    });

    data.charBoxes.forEach((box, index) => {
      const charTop = this.debugYAxisUp ? box.y + box.height / 2 : box.y - box.height / 2;
      const firstLabelOffset = this.debugYAxisUp ? -2 : 2;
      const secondLabelOffset = this.debugYAxisUp ? -Math.max(8, box.height * 0.2) : Math.max(8, box.height * 0.2);

      if (this.debugVisibility.showCharBoxes) {
        this.renderer.drawQuad({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          fillColor: this.debugStyle.charBoxFill,
          borderColor: this.debugStyle.charBoxColor,
          borderWidth: 1
        });
      }

      if (this.debugVisibility.showCharIndices) {
        this.renderer.drawText({
          text: String(index),
          x: box.x + 2,
          y: charTop + firstLabelOffset,
          color: this.debugStyle.charIndexColor,
          font: '10px monospace'
        });
      }

      if (this.debugVisibility.showChars) {
        const label = data.chars?.[index];
        if (!label) return;
        this.renderer.drawText({
          text: label,
          x: box.x + 2,
          y: charTop + secondLabelOffset,
          color: 'rgba(255,255,255,0.95)',
          font: `${Math.max(12, Math.round(box.height * 0.6))}px monospace`
        });
      }
    });

    data.gapPositions?.forEach((gap) => {
      this.renderer.drawLine({
        x1: gap.x,
        y1: gap.y - gap.height / 2,
        x2: gap.x,
        y2: gap.y + gap.height / 2,
        color: this.debugStyle.gapColor,
        opacity: gap.strong ? 0.9 : 0.55,
        width: 1
      });
    });
  }

  private mergeBoxes(boxes: Box[]): Box[] {
    if (boxes.length === 0) return [];
    const sorted = [...boxes].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    const result: Box[] = [];

    for (const box of sorted) {
      const last = result[result.length - 1];
      if (!last) {
        result.push({ ...box });
        continue;
      }

      const sameRow = Math.abs(last.y - box.y) <= 1;
      const touching = box.x <= last.x + last.width + 1;
      const sameHeight = Math.abs(last.height - box.height) <= 1;

      if (sameRow && touching && sameHeight) {
        last.width = Math.max(last.x + last.width, box.x + box.width) - last.x;
      } else {
        result.push({ ...box });
      }
    }

    return result;
  }
}
