import type { Box, LineInfo } from '../types';

/**
 * Draw options for a rectangle/quad primitive.
 *
 * Coordinates use the renderer's current transformed space.
 */
export interface QuadOptions {
  /** Center X coordinate of the quad. */
  x: number;
  /** Center Y coordinate of the quad. */
  y: number;
  /** Quad width. */
  width: number;
  /** Quad height. */
  height: number;
  /** Optional fill color (CSS color string). */
  fillColor?: string;
  /** Optional border/stroke color (CSS color string). */
  borderColor?: string;
  /** Optional border/stroke width. */
  borderWidth?: number;
  /** Optional alpha in range `[0, 1]`. */
  opacity?: number;
  /** Optional corner radius for rounded rectangles. */
  cornerRadius?: number;
  /** Optional compositing mode used by 2D backends. */
  blendMode?: GlobalCompositeOperation;
  /** Optional rendering order/layer hint for 3D backends. */
  renderOrder?: number;
}

/**
 * Draw options for a line segment primitive.
 */
export interface LineOptions {
  /** Line start X coordinate. */
  x1: number;
  /** Line start Y coordinate. */
  y1: number;
  /** Line end X coordinate. */
  x2: number;
  /** Line end Y coordinate. */
  y2: number;
  /** Line color (CSS color string). */
  color: string;
  /** Optional line width. */
  width?: number;
  /** Optional alpha in range `[0, 1]`. */
  opacity?: number;
  /** Optional dash pattern (`[dash, gap, ...]`). */
  dashed?: number[];
  /** Optional rendering order/layer hint for 3D backends. */
  renderOrder?: number;
}

/**
 * Draw options for debug/overlay text.
 */
export interface TextOptions {
  /** Text content to render. */
  text: string;
  /** Anchor X coordinate. */
  x: number;
  /** Anchor Y coordinate. */
  y: number;
  /** Text color (CSS color string). */
  color: string;
  /** Optional font declaration (for example `12px monospace`). */
  font?: string;
  /** Optional horizontal alignment. */
  align?: CanvasTextAlign;
  /** Optional vertical baseline alignment. */
  baseline?: CanvasTextBaseline;
  /** Optional alpha in range `[0, 1]`. */
  opacity?: number;
}

/**
 * Draw options for a wireframe box.
 */
export interface BoxOptions {
  /** Box geometry to draw. */
  box: Box;
  /** Stroke color (CSS color string). */
  color: string;
  /** Optional alpha in range `[0, 1]`. */
  opacity?: number;
  /** Optional stroke width. */
  lineWidth?: number;
  /** Optional rendering order/layer hint for 3D backends. */
  renderOrder?: number;
}

/**
 * View transform applied by renderer backends before drawing primitives.
 */
export interface Transform {
  /** Translation on X axis. */
  x?: number;
  /** Translation on Y axis. */
  y?: number;
  /** Scale factor on X axis. */
  scaleX?: number;
  /** Scale factor on Y axis. */
  scaleY?: number;
  /** Rotation in radians. */
  rotation?: number;
}

/**
 * Engine-agnostic immediate-mode rendering contract used by `CursorRenderer`.
 */
export interface I3DRenderer {
  /** Initializes renderer resources and binds output canvas. */
  initialize(canvas: HTMLCanvasElement): void;
  /** Releases all renderer-side resources. */
  destroy(): void;
  /** Begins a frame; clear/reset temporary state as needed. */
  beginFrame(): void;
  /** Ends a frame; flushes pending draw operations if needed. */
  endFrame(): void;
  /** Draws a quad primitive. */
  drawQuad(options: QuadOptions): void;
  /** Draws a line primitive. */
  drawLine(options: LineOptions): void;
  /** Draws debug/overlay text. */
  drawText(options: TextOptions): void;
  /** Draws a wireframe box primitive. */
  drawBox(options: BoxOptions): void;
  /** Applies current frame transform. */
  setTransform(transform: Transform): void;
  /** Resets transform to identity. */
  resetTransform(): void;
}

/**
 * Visual rendering strategy used by adapters that support multiple cursor implementations.
 *
 * Values:
 * - `'plane'`: Preferred default. Renders cursor and overlays with plane/quads so thickness and fill
 *   remain visually stable under zoom and work well for most 2D/orthographic editors.
 * - `'geometry'`: Uses line/geometry primitives. Lightweight but line thickness can vary by backend
 *   (for example due to platform line-width support limits).
 * - `'sprite'`: Uses sprite-based billboards, useful when the cursor should always face camera in
 *   3D scenes. Sprite scaling is camera-dependent and may need adapter-specific tuning.
 */
export type CursorRenderMode = 'plane' | 'geometry' | 'sprite';

/**
 * Cursor visual style.
 */
export interface CursorStyle {
  /**
   * Cursor stroke thickness in screen-space pixels.
   *
   * This value is treated as an approximate pixel size; `CursorRenderer` compensates for the
   * current view transform scale so that the visual thickness remains stable under zoom.
   * Use a larger value (for example `2` to `4`) for better visibility on high-DPI or zoomed scenes.
   */
  width: number;
  /** Minimum cursor height used by fixed/derived height modes. */
  height: number;
  /** Height behavior strategy (`fixed`, `lineHeight`, or `charHeight`). */
  heightMode: 'fixed' | 'lineHeight' | 'charHeight';
  /** Primary cursor color. */
  color: string;
  /** Optional glow color rendered as a wider underlay stroke. */
  glowColor?: string;
  /** Glow opacity/intensity multiplier in range `[0, 1]`. */
  glowIntensity?: number;
  /** Blink period in seconds (lower means faster blink). */
  blinkSpeed: number;
  /** Enables/disables blinking animation. */
  blinkEnabled: boolean;
  /** Whether cursor should always face camera in adapters that support billboarding. */
  billboard: boolean;
  /** Whether depth testing is enabled in 3D adapters. */
  depthTest: boolean;
  /** Renderer order hint for layering cursor above other overlays. */
  renderOrder: number;
  /** Preferred rendering strategy for compatible adapters. */
  mode: CursorRenderMode;
}

/**
 * Selection visual style.
 */
export interface SelectionStyle {
  /** Fill color for selected character/background regions. */
  fillColor: string;
  /** Optional border color for selection regions. */
  borderColor?: string;
  /** Optional border width for selection regions. */
  borderWidth?: number;
  /** Optional corner radius for selection quads. */
  cornerRadius?: number;
  /** Blend mode used for selection overlay compositing. */
  blendMode: 'normal' | 'additive' | 'multiply';
  /** Enables optional selection animation in adapters that support it. */
  animate?: boolean;
  /** Selection aggregation strategy (`perChar` or line/segment `merged`). */
  strategy?: 'perChar' | 'merged';
}

/**
 * Debug overlay palette and stroke settings.
 */
export interface DebugStyle {
  /** Stroke color for character bounding boxes. */
  charBoxColor: string;
  /** Fill color for character bounding boxes. */
  charBoxFill: string;
  /** Color used for character index labels. */
  charIndexColor: string;
  /** Fill color for currently hovered line background. */
  rowHoverColor: string;
  /** Stroke color for line boundary markers. */
  rowBoundaryColor: string;
  /** Color for cursor gap markers. */
  gapColor: string;
  /** Color for baseline indicators. */
  baselineColor: string;
  /** Stroke color for container bounds. */
  containerColor: string;
}

/** Toggles for optional debug sub-layers. */
export interface DebugVisibility {
  /** Whether character bounding boxes are shown. */
  showCharBoxes: boolean;
  /** Whether line index labels are shown. */
  showLineIndices: boolean;
  /** Whether character index labels are shown. */
  showCharIndices: boolean;
  /** Whether character glyph labels are shown. */
  showChars: boolean;
}

/**
 * One visualized insertion-gap marker used by debug overlays.
 */
export interface GapPosition {
  /** Gap center X coordinate. */
  x: number;
  /** Gap center Y coordinate. */
  y: number;
  /** Gap marker height. */
  height: number;
  /** Marks a stronger/emphasized gap candidate. */
  strong?: boolean;
}

/**
 * Snapshot payload consumed by debug drawing.
 */
export interface DebugData {
  /** Overall text container bounds. */
  containerBox: Box;
  /** Per-character boxes in layout order. */
  charBoxes: Box[];
  /** Optional character list matching `charBoxes` indices. */
  chars?: string[];
  /** Computed line metadata used by cursor/selection logic. */
  lines: LineInfo[];
  /** Optional currently hovered line index. */
  hoverLineIndex?: number;
  /** Optional cursor gap markers (insertion candidates). */
  gapPositions?: GapPosition[];
}

/**
 * Constructor options for `CursorRenderer`.
 */
export interface CursorRendererOptions {
  /** Concrete renderer adapter implementation. */
  renderer: I3DRenderer;
  /** Partial override for cursor style defaults. */
  cursorStyle?: Partial<CursorStyle>;
  /** Partial override for selection style defaults. */
  selectionStyle?: Partial<SelectionStyle>;
  /** Partial override for debug style defaults. */
  debugStyle?: Partial<DebugStyle>;
  /** Partial override for debug sub-layer visibility. */
  debugVisibility?: Partial<DebugVisibility>;
  /** Enables/disables selection overlay rendering. */
  enableSelection?: boolean;
  /** Enables/disables debug overlay rendering. */
  enableDebug?: boolean;
  /** Indicates debug overlay Y-axis direction (`true` for Y-up, `false` for Y-down). */
  debugYAxisUp?: boolean;
  /** Reserved flag for bloom/post-processing support. */
  enableBloom?: boolean;
  /** Reserved flag for instanced rendering paths. */
  useInstancing?: boolean;
  /** Reserved batch size hint for future adapter optimizations. */
  batchSize?: number;
}
