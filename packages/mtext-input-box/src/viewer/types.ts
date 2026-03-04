import type { Box, CursorStyle, SelectionStyle } from '@mlightcad/text-box-cursor';
import type * as THREE from 'three';

/** Vertical script style for a character run. */
export type CharScript = 'normal' | 'superscript' | 'subscript';
/** Character-level formatting attributes used by rich text editing operations. */
export interface CharFormat {
  /** Font family name (for example `Arial` or `sans-serif`). */
  fontFamily: string;
  /** Font size in world units. */
  fontSize: number;
  /** Whether bold style is enabled. */
  bold: boolean;
  /** Whether italic style is enabled. */
  italic: boolean;
  /** Whether underline decoration is enabled. */
  underline: boolean;
  /** Whether overline decoration is enabled. */
  overline: boolean;
  /** Vertical script style (normal/superscript/subscript). */
  script: CharScript;
  /** Whether strike-through decoration is enabled. */
  strike: boolean;
  /** AutoCAD ACI indexed color. When present (1..255), it takes precedence over `rgb`. */
  aci: number | null;
  /** Explicit RGB color packed as `0xRRGGBB`. */
  rgb: number | null;
}

/** Internal editor state snapshot used for updates and history-like operations. */
export interface EditorState {
  /** Full MTEXT source string. */
  mtextString: string;
  /** Current cursor index in the logical character sequence. */
  cursorIndex: number;
  /** Selection start index (inclusive). */
  selectionStart: number;
  /** Selection end index (exclusive). */
  selectionEnd: number;
  /** Active format applied to newly inserted text. */
  currentFormat: CharFormat;
}

/** Per-character layout box resolved from rendered MTEXT output. */
export interface LayoutCharBox {
  /** Character center X coordinate. */
  x: number;
  /** Character center Y coordinate. */
  y: number;
  /** Character box width. */
  width: number;
  /** Character box height. */
  height: number;
  /** Character value represented by this box. */
  char: string;
  /** Effective format used when laying out this character. */
  format: CharFormat;
}

/** Container bounds for the editable text region. */
export interface RendererContainerBox {
  /** Container center X coordinate. */
  x: number;
  /** Container center Y coordinate. */
  y: number;
  /** Container width. */
  width: number;
  /** Container height. */
  height: number;
}

/** Line-level layout metadata returned by the renderer. */
export interface RendererLineInfo {
  /** First character index in this line. */
  startIndex: number;
  /** Last character index in this line. */
  endIndex: number;
  /** Line center Y coordinate. */
  y: number;
  /** Computed line height. */
  height: number;
}

/** Renderer output consumed by cursor logic and scene visualization. */
export interface MTextRendererOutput {
  /** Per-character layout boxes in document order. */
  boxes: LayoutCharBox[];
  /** Overall container bounds for hit-testing and selection visualization. */
  containerBox: RendererContainerBox;
  /** Optional line metadata used for vertical cursor navigation. */
  lines?: RendererLineInfo[];
}

/** Snapshot of the latest geometry payload passed to `TextBoxCursor.updateData`. */
export interface CursorLayoutData {
  /** Container bounds passed to TextBoxCursor for caret/selection positioning. */
  containerBox: Box;
  /** Per-character layout boxes in logical text order. */
  charBoxes: Array<Box>;
  /** Optional explicit line break boundary indices. */
  lineBreakIndices?: number[];
  /** Optional per-line layout metadata. */
  lineLayouts?: Array<{ y: number; height: number }>;
}

/** Visual style options for the editor bounding box overlay. */
export interface MTextBoundingBoxStyle {
  /** Stroke/fill color accepted by three.js materials. */
  color?: string | number;
  /** Bounding box opacity in range `[0, 1]`. */
  opacity?: number;
  /** Extra padding added around rendered text bounds. */
  padding?: number;
  /** Z-axis offset used to avoid depth conflicts. */
  zOffset?: number;
}

/** Construction options for `MTextInputBox`. */
export type MTextToolbarTheme = 'light' | 'dark';

/** Toolbar options for built-in editor toolbar UI. */
export interface MTextToolbarOptions {
  /** Enables the built-in toolbar. Defaults to true. */
  enabled?: boolean;
  /** Toolbar color theme. Defaults to dark. */
  theme?: MTextToolbarTheme;
  /** Available font family options shown in toolbar dropdown. */
  fontFamilies?: string[];
  /** Custom DOM container to mount toolbar. Defaults to document.body. */
  container?: HTMLElement;
  /** Vertical offset in pixels above editor top edge. Defaults to 10. */
  offsetY?: number;
}

export interface MTextInputBoxOptions {
  /** Target three.js scene that owns editor meshes. */
  scene: THREE.Scene;
  /** Camera used for coordinate conversion and interaction. */
  camera: THREE.Camera;
  /** Optional initial MTEXT source string. */
  initialText?: string;
  /** Preferred editor width. */
  width: number;
  /** Optional world-space origin of the editor container. */
  position?: THREE.Vector3;
  /**
   * Single default style source for the component.
   *
   * It is used for:
   * - insertion format of newly typed characters
   * - derived fallback text style passed to `@mlightcad/mtext-renderer`
   */
  defaultFormat?: Partial<CharFormat>;
  /** Partial cursor style overrides forwarded to cursor renderer. */
  cursorStyle?: Partial<CursorStyle>;
  /** Partial selection style overrides forwarded to cursor renderer. */
  selectionStyle?: Partial<SelectionStyle>;
  /** Enables/disables word wrapping behavior. */
  enableWordWrap?: boolean;
  /** Optional worker URL used by renderer implementations that support workers. */
  workerUrl?: string | URL;
  /** Element used for built-in IME bridge attachment. */
  imeTarget: HTMLElement;
  /** Whether to render a visible editor bounding box overlay. */
  showBoundingBox?: boolean;
  /** Optional style overrides for the bounding box overlay. */
  boundingBoxStyle?: MTextBoundingBoxStyle;
  /** Built-in toolbar configuration (DOM overlay). */
  toolbar?: MTextToolbarOptions;
}

/** Directional cursor movement commands. */
export type CursorDirection =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'lineStart'
  | 'lineEnd'
  | 'wordPrev'
  | 'wordNext';

/** Directional selection extension commands. */
export type SelectionDirection = 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd';

/** Events emitted by `MTextInputBox`. */
export type MTextInputBoxEvent = 'change' | 'selectionChange' | 'cursorMove' | 'show' | 'close';

/** Backward-compatible alias for `MTextInputBoxEvent`. */
export type MTextEditorEvent = MTextInputBoxEvent;

/** Backward-compatible alias for `MTextInputBoxOptions`. */
export type MTextEditorOptions = MTextInputBoxOptions;
