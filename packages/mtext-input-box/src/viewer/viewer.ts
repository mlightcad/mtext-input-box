import {
  CursorRenderer,
  TextBoxCursor,
  ThreeJsRendererAdapter,
  type Box,
  type LineLayoutInput,
  type CursorStyle,
  type DebugVisibility,
  type SelectionStyle
} from '@mlightcad/text-box-cursor';
import {
  getColorByIndex,
  UnifiedRenderer,
  MTextAttachmentPoint,
  MTextFlowDirection,
  type MTextData,
  type MTextObject,
  type TextStyle
} from '@mlightcad/mtext-renderer';
import * as THREE from 'three';
import { MTextContext, MTextLineAlignment } from '@mlightcad/mtext-parser';
import { defaultCharFormat, sameFormat } from './format';
import { MTextDocument, type MTextAst, type MTextStyle } from '../model';
import { EditorUiAdapter } from '../controller';
import { MTextToolbar, type ToolbarOptions, type ToolbarSessionOptions } from '../ui/toolbar';
import type {
  CharFormat,
  CursorLayoutData,
  CursorDirection,
  EditorState,
  MTextBoundingBoxStyle,
  MTextInputBoxEvent,
  MTextInputBoxOptions,
  MTextToolbarTheme,
  SelectionDirection
} from './types';

type Handler = () => void;
type HistorySnapshot = {
  ast: MTextAst;
  cursor: number;
  selection: { start: number; end: number } | null;
  currentFormat: CharFormat;
};

/**
 * Three.js based MText editor component with core text editing interaction.
 */
export class MTextInputBox {
  private static activeEditor: MTextInputBox | null = null;
  private static sharedToolbar: MTextToolbar | null = null;
  private static sharedToolbarContainer: HTMLElement | null = null;
  private static sharedToolbarFontFamiliesKey = '';
  private static readonly instances = new Set<MTextInputBox>();

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly mtextRenderer: UnifiedRenderer;
  private readonly cursorRenderer: CursorRenderer;
  private static readonly FALLBACK_LINE_ADVANCE_RATIO = 1.5;

  private width: number;
  private position: THREE.Vector3;
  private enableWordWrap: boolean;

  private mtextString = '';
  private cursorIndex = 0;
  private selectionStart = 0;
  private selectionEnd = 0;
  private readonly baseFormat: CharFormat;
  private currentFormat: CharFormat;
  private readonly defaultTextStyle: TextStyle;

  private cursorLogic: TextBoxCursor;
  private layoutContainer: Box = { x: 0, y: 0, width: 1, height: 1 };
  private isDragging = false;
  private pendingCursorLineHint: number | null = null;
  private latestCursorLayoutData: CursorLayoutData = {
    containerBox: { x: 0, y: 0, width: 1, height: 1 },
    charBoxes: []
  };

  private renderedObject: MTextObject | null = null;
  private boundingBoxObject: THREE.LineLoop | null = null;
  private boundingBoxPadding = 1;
  private boundingBoxZOffset = 0.01;
  private rendererReady = false;
  private toolbarTheme: MTextToolbarTheme = 'dark';
  private toolbarOffsetY = 10;
  private debugMode = false;
  private debugVisibility: DebugVisibility = {
    showCharBoxes: true,
    showLineIndices: true,
    showCharIndices: true,
    showChars: true
  };
  private readonly maxHistorySize = 100;
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];

  // MVC model/controller
  private document: MTextDocument;
  private uiAdapter: EditorUiAdapter;

  // IME bridge (encapsulated in component)
  private imeInput: HTMLTextAreaElement | null = null;
  private imeTarget: HTMLElement | null = null;
  private lastImeTarget: HTMLElement | null = null;
  private reopenTarget: HTMLElement | null = null;
  private pointerTarget: HTMLElement | null = null;
  private imeComposing = false;
  private imeFocusTimer: number | null = null;
  private closed = false;
  private toolbarEnabled = true;
  private toolbarContainer: HTMLElement | null = null;
  private toolbarFontFamilies: string[] | null = null;

  private readonly onImeKeyDown = (event: KeyboardEvent): void => {
    if (!this.isActiveEditor()) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const isPrintable = !ctrl && !event.altKey && event.key.length === 1;
    if (isPrintable || event.isComposing || event.key === 'Process') return;

    const handled = this.handleKeyDown(event);
    if (handled) event.preventDefault();
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (!this.isActiveEditor()) return;
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName ?? '';
    const isNativeEditable =
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      Boolean(target?.isContentEditable);

    if (isNativeEditable && target !== this.imeInput) return;

    const ctrl = event.ctrlKey || event.metaKey;
    const isPrintable = !ctrl && !event.altKey && event.key.length === 1;
    if (isPrintable || this.imeComposing || event.isComposing || event.key === 'Process') {
      this.refocusImeInputSoon();
      return;
    }

    const handled = this.handleKeyDown(event);
    if (handled) {
      event.preventDefault();
      this.refocusImeInputSoon();
    }
  };

  private readonly onImeBeforeInput = (event: InputEvent): void => {
    if (!this.isActiveEditor()) return;
    if (event.isComposing) return;
    const inputType = event.inputType;

    if (inputType === 'insertText' || inputType === 'insertCompositionText') {
      const handled = this.handleTextInput(event.data ?? '');
      if (handled) event.preventDefault();
      return;
    }

    if (inputType === 'insertParagraph') {
      const handled = this.handleTextInput('\n');
      if (handled) event.preventDefault();
    }
  };

  private readonly onImeCompositionStart = (): void => {
    if (!this.isActiveEditor()) return;
    this.imeComposing = true;
    this.updateImeAnchorPosition();
    this.refocusImeInputSoon();
  };

  private readonly onImeCompositionEnd = (event: CompositionEvent): void => {
    if (!this.isActiveEditor()) return;
    this.imeComposing = false;
    const data = event.data ?? '';
    const handled = this.handleTextInput(data);
    if (handled && this.imeInput) {
      this.imeInput.value = '';
    }
    this.refocusImeInputSoon();
  };

  private readonly onImeTargetMouseDown = (): void => {
    if (!this.isActiveEditor()) return;
    this.refocusImeInputSoon();
  };

  private readonly onPointerMouseDown = (event: MouseEvent): void => {
    if (this.closed) return;
    if (event.altKey || event.button === 1) return;
    const local = this.pointerEventToEditorLocal(event);
    if (!local) return;
    const insideEditor = this.isPointInContainer(local.x, local.y);
    if (!insideEditor) {
      if (this.isActiveEditor()) {
        this.closeEditor();
      }
      return;
    }
    this.activateEditor();
    this.handleMouseDown(local.x, local.y, event.shiftKey);
    this.refocusImeInputSoon();
  };

  private readonly onPointerMouseMove = (event: MouseEvent): void => {
    if (!this.isActiveEditor()) return;
    if (event.buttons === 0 || !this.isDragging) return;
    const local = this.pointerEventToEditorLocal(event);
    if (!local) return;
    this.handleMouseMove(local.x, local.y);
  };

  private readonly onPointerMouseUp = (): void => {
    if (!this.isActiveEditor()) return;
    this.handleMouseUp();
  };

  private readonly onPointerDoubleClick = (event: MouseEvent): void => {
    if (!this.isActiveEditor()) return;
    const local = this.pointerEventToEditorLocal(event);
    if (!local) return;
    this.handleDoubleClick(local.x, local.y);
    this.refocusImeInputSoon();
  };

  private readonly onReopenDoubleClick = (event: MouseEvent): void => {
    if (!this.closed) return;
    if (!this.shouldReopenFromDoubleClick(event)) return;
    this.showEditor();
  };

  private readonly handlers: Record<MTextInputBoxEvent, Set<Handler>> = {
    change: new Set(),
    selectionChange: new Set(),
    cursorMove: new Set(),
    show: new Set(),
    close: new Set()
  };

  constructor(options: MTextInputBoxOptions) {
    MTextInputBox.instances.add(this);
    this.scene = options.scene;
    this.camera = options.camera;
    this.toolbarTheme = options.toolbar?.theme ?? 'dark';
    this.toolbarOffsetY = Math.max(0, options.toolbar?.offsetY ?? 10);
    this.toolbarEnabled = options.toolbar?.enabled ?? true;
    this.toolbarContainer = options.toolbar?.container ?? null;
    this.toolbarFontFamilies = options.toolbar?.fontFamilies ?? null;
    this.width = Math.max(1, options.width);
    this.position = options.position?.clone() ?? new THREE.Vector3(0, 0, 0);
    this.enableWordWrap = options.enableWordWrap ?? true;

    this.baseFormat = { ...defaultCharFormat(), ...(options.defaultFormat ?? {}) };
    this.currentFormat = { ...this.baseFormat };
    this.defaultTextStyle = this.createDefaultTextStyle();

    this.document = new MTextDocument();
    this.uiAdapter = new EditorUiAdapter(this.document);

    this.mtextRenderer = new UnifiedRenderer('main', {
      workerUrl:
        typeof options.workerUrl === 'string'
          ? options.workerUrl
          : options.workerUrl?.toString() ?? './assets/mtext-renderer-worker.js'
    });

    this.cursorLogic = new TextBoxCursor({
      containerBox: { x: 0, y: 0, width: this.width, height: 1 },
      charBoxes: [],
      lineTolerance: 4
    });

    const cursorStyle: Partial<CursorStyle> = { ...(options.cursorStyle ?? {}) };
    cursorStyle.color ??= '#ffffff';
    cursorStyle.glowColor ??= '#ffffff';

    this.cursorRenderer = new CursorRenderer({
      renderer: new ThreeJsRendererAdapter({ scene: this.scene, camera: this.camera }),
      cursorStyle,
      selectionStyle: options.selectionStyle as Partial<SelectionStyle>,
      enableDebug: false,
      enableSelection: true,
      debugYAxisUp:
        this.camera instanceof THREE.OrthographicCamera ? this.camera.top >= this.camera.bottom : true,
      debugVisibility: this.debugVisibility
    });
    this.cursorRenderer.setViewTransform({ x: this.position.x, y: this.position.y, scaleX: 1, scaleY: 1 });
    this.createBoundingBox(options.showBoundingBox ?? true, options.boundingBoxStyle);

    this.setText(options.initialText ?? '');
    this.attachIme(options.imeTarget);

    void this.initializeRenderer();
  }

  /** Sets full text and rebuilds model/layout state. */
  public setText(text: string): void {
    this.document = this.createNormalizedDocument(text);
    this.document.cursor = 0;
    this.uiAdapter = new EditorUiAdapter(this.document);
    this.clearHistory();
    this.syncUiStateFromDocument();
    this.relayout();
    this.emit('change');
  }

  /** Returns current MTEXT source string. */
  public getText(): string {
    this.syncUiStateFromDocument();
    return this.mtextString;
  }

  /** Returns plain text resolved from document AST. */
  public getPlainText(): string {
    return this.getChars().join('');
  }

  /** Inserts text at cursor; replaces selection when present. */
  public insertText(text: string): void {
    if (text.length === 0) return;
    if (text === '\n') {
      const currentLineIndex = this.cursorLogic.getCursorState().lineIndex;
      this.pendingCursorLineHint = currentLineIndex >= 0 ? currentLineIndex + 1 : 0;
    }
    this.commitHistoryEdit(() => {
      this.syncDocumentFromUiState();
      this.uiAdapter.execute({
        type: 'insertText',
        text,
        style: this.toDocumentStyle(this.currentFormat)
      });
      this.syncUiStateFromDocument();
      this.relayout();
    });
  }

  /** Backspace behavior: remove selection or previous character. */
  public deleteBackward(): void {
    this.commitHistoryEdit(() => {
      this.syncDocumentFromUiState();
      this.uiAdapter.execute({ type: 'backspace' });
      this.syncUiStateFromDocument();
      this.relayout();
    });
  }

  /** Delete behavior: remove selection or next character. */
  public deleteForward(): void {
    this.commitHistoryEdit(() => {
      this.syncDocumentFromUiState();
      this.uiAdapter.execute({ type: 'delete' });
      this.syncUiStateFromDocument();
      this.relayout();
    });
  }

  /** Restores previous text-editing state. Returns true when successful. */
  public undo(): boolean {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    this.redoStack.push(this.createHistorySnapshot());
    this.restoreHistorySnapshot(snapshot);
    return true;
  }

  /** Restores next text-editing state from redo history. Returns true when successful. */
  public redo(): boolean {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return false;
    this.undoStack.push(this.createHistorySnapshot());
    this.restoreHistorySnapshot(snapshot);
    return true;
  }

  /** Moves cursor and clears selection. */
  public moveCursor(direction: CursorDirection): void {
    switch (direction) {
      case 'left':
        this.cursorLogic.moveLeft();
        break;
      case 'right':
        this.cursorLogic.moveRight();
        break;
      case 'up':
        this.cursorLogic.moveUp();
        break;
      case 'down':
        this.cursorLogic.moveDown();
        break;
      case 'lineStart':
        this.cursorLogic.moveToLineStart();
        break;
      case 'lineEnd':
        this.cursorLogic.moveToLineEnd();
        break;
      case 'wordPrev':
        this.cursorLogic.moveTo(this.findPrevWordStart(this.cursorLogic.getCurrentIndex()));
        break;
      case 'wordNext':
        this.cursorLogic.moveTo(this.findNextWordStart(this.cursorLogic.getCurrentIndex()));
        break;
      default:
        break;
    }
    this.cursorLogic.clearSelection();
    this.syncStateFromCursor();
    this.emit('cursorMove');
    this.emit('selectionChange');
  }

  /** Extends selection toward direction. */
  public extendSelection(direction: SelectionDirection): void {
    const selection = this.cursorLogic.getSelection();
    const anchor = selection ? selection.anchor : this.cursorLogic.getCurrentIndex();

    this.cursorLogic.clearSelection();
    this.cursorLogic.moveTo(this.cursorIndex);

    switch (direction) {
      case 'left':
        this.cursorLogic.moveTo(this.cursorLogic.getCurrentIndex() - 1);
        break;
      case 'right':
        this.cursorLogic.moveTo(this.cursorLogic.getCurrentIndex() + 1);
        break;
      case 'up':
        this.cursorLogic.moveUp();
        break;
      case 'down':
        this.cursorLogic.moveDown();
        break;
      case 'lineStart':
        this.cursorLogic.moveToLineStart();
        break;
      case 'lineEnd':
        this.cursorLogic.moveToLineEnd();
        break;
      default:
        break;
    }

    this.cursorLogic.setSelectionWithDirection(anchor, this.cursorLogic.getCurrentIndex());
    this.syncStateFromCursor();
    this.emit('selectionChange');
  }

  /** Selects all text. */
  public selectAll(): void {
    this.cursorLogic.selectAll();
    this.syncStateFromCursor();
    this.emit('selectionChange');
  }

  /** Clears current selection. */
  public clearSelection(): void {
    this.cursorLogic.clearSelection();
    this.syncStateFromCursor();
    this.emit('selectionChange');
  }

  /** Enables/disables debug overlay rendering. */
  public setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    this.cursorRenderer.setDebugMode(enabled);
  }

  /** Returns current debug mode flag. */
  public isDebugMode(): boolean {
    return this.debugMode;
  }

  /** Partially overrides visibility of debug sub-layers. */
  public setDebugVisibility(visibility: Partial<DebugVisibility>): void {
    this.debugVisibility = { ...this.debugVisibility, ...visibility };
    this.cursorRenderer.setDebugVisibility(visibility);
  }

  /** Returns current debug sub-layer visibility flags. */
  public getDebugVisibility(): DebugVisibility {
    return { ...this.debugVisibility };
  }

  /** Sets built-in toolbar theme. */
  public setToolbarTheme(theme: MTextToolbarTheme): void {
    this.toolbarTheme = theme;
    if (this.isActiveEditor()) {
      this.getActiveToolbar()?.setTheme(theme);
    }
  }

  /** Returns built-in toolbar theme. */
  public getToolbarTheme(): MTextToolbarTheme {
    return this.toolbarTheme;
  }
  /** Attaches IME/input bridge to a target element (typically the render canvas). */
  public attachIme(target: HTMLElement): void {
    const wasClosed = this.closed;
    this.lastImeTarget = target;
    this.bindReopenDoubleClick(target);
    this.imeTarget = target;
    this.attachPointerInteractions(target);
    this.closed = false;
    if (!MTextInputBox.activeEditor) {
      this.activateEditor();
    } else if (MTextInputBox.activeEditor === this) {
      this.activateEditor();
    } else {
      this.cursorRenderer.hide();
      if (this.boundingBoxObject) this.boundingBoxObject.visible = false;
    }
    if (wasClosed) this.emit('show');
  }

  /** Detaches and destroys IME/input bridge. */
  public detachIme(): void {
    if (!this.imeInput) {
      return;
    }

    this.imeInput.removeEventListener('keydown', this.onImeKeyDown);
    this.imeInput.removeEventListener('beforeinput', this.onImeBeforeInput as EventListener);
    this.imeInput.removeEventListener('compositionstart', this.onImeCompositionStart);
    this.imeInput.removeEventListener('compositionend', this.onImeCompositionEnd as EventListener);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    if (this.imeTarget) {
      this.imeTarget.removeEventListener('mousedown', this.onImeTargetMouseDown);
    }

    this.imeInput.remove();
    this.imeInput = null;
    this.imeComposing = false;

    if (this.imeFocusTimer !== null) {
      window.clearTimeout(this.imeFocusTimer);
      this.imeFocusTimer = null;
    }
  }

  /** Returns cursor index. */
  public getCursorIndex(): number {
    return this.cursorIndex;
  }

  /** Returns normalized selection range. */
  public getSelectionRange(): { start: number; end: number; isCollapsed: boolean } {
    const start = Math.min(this.selectionStart, this.selectionEnd);
    const end = Math.max(this.selectionStart, this.selectionEnd);
    return { start, end, isCollapsed: start === end };
  }

  /** Returns the latest geometry payload forwarded to `TextBoxCursor.updateData`. */
  public getCursorLayoutData(): CursorLayoutData {
    const snapshot: CursorLayoutData = {
      containerBox: { ...this.latestCursorLayoutData.containerBox },
      charBoxes: this.latestCursorLayoutData.charBoxes.map((box) => ({ ...box }))
    };
    if (this.latestCursorLayoutData.lineBreakIndices) {
      snapshot.lineBreakIndices = [...this.latestCursorLayoutData.lineBreakIndices];
    }
    if (this.latestCursorLayoutData.lineLayouts) {
      snapshot.lineLayouts = this.latestCursorLayoutData.lineLayouts.map((line) => ({ ...line }));
    }
    console.log(snapshot);
    return snapshot;
  }

  /** Sets current insertion format. */
  public setCurrentFormat(format: Partial<CharFormat>): void {
    const next = this.mergeCharFormat(this.currentFormat, format);
    this.currentFormat = next;

    const selection = this.getSelectionRange();
    if (!selection.isCollapsed) {
      this.commitHistoryEdit(() => {
        this.syncDocumentFromUiState();

        const nodesToUpdate = this.getNodesByLogicalRange(selection.start, selection.end);
        for (const node of nodesToUpdate) {
          const nodeFormat = this.toCharFormat(node.style);
          const mergedNodeFormat = this.mergeCharFormat(nodeFormat, format);
          node.style = this.toDocumentStyle(mergedNodeFormat);
        }

        this.syncUiStateFromDocument();
        this.relayout();
      });
    }

    this.getActiveToolbar()?.setFormat(this.currentFormat);
  }

  /** Returns current insertion format. */
  public getCurrentFormat(): CharFormat {
    return { ...this.currentFormat };
  }

  /** Returns renderer default text style derived from `defaultFormat`. */
  public getDefaultTextStyle(): TextStyle {
    return { ...this.defaultTextStyle };
  }

  /** Keyboard event handler. Returns true when consumed. */
  public handleKeyDown(event: KeyboardEvent): boolean {
    // IME composition uses beforeinput/composition events for committed text.
    if (event.isComposing || event.key === 'Process') {
      return false;
    }

    if (event.key === 'Escape') {
      this.closeEditor();
      return true;
    }

    const isMac = this.isMacPlatform();
    const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
    const wordNavModifier = isMac ? event.altKey : event.ctrlKey;

    if (primaryModifier && event.key.toLowerCase() === 'a') {
      this.selectAll();
      return true;
    }
    if (primaryModifier && event.key.toLowerCase() === 'z') {
      return event.shiftKey ? this.redo() : this.undo();
    }
    if (!isMac && primaryModifier && event.key.toLowerCase() === 'y') {
      return this.redo();
    }

    if (event.shiftKey) {
      if (event.key === 'ArrowLeft') return this.consumeExtend('left');
      if (event.key === 'ArrowRight') return this.consumeExtend('right');
      if (event.key === 'ArrowUp') return this.consumeExtend('up');
      if (event.key === 'ArrowDown') return this.consumeExtend('down');
      if (event.key === 'Home') return this.consumeExtend('lineStart');
      if (event.key === 'End') return this.consumeExtend('lineEnd');
    }

    if (isMac && event.metaKey && event.key === 'ArrowLeft') return this.consumeMove('lineStart');
    if (isMac && event.metaKey && event.key === 'ArrowRight') return this.consumeMove('lineEnd');

    if (event.key === 'ArrowLeft') return this.consumeMove(wordNavModifier ? 'wordPrev' : 'left');
    if (event.key === 'ArrowRight') return this.consumeMove(wordNavModifier ? 'wordNext' : 'right');
    if (event.key === 'ArrowUp') return this.consumeMove('up');
    if (event.key === 'ArrowDown') return this.consumeMove('down');
    if (event.key === 'Home') return this.consumeMove('lineStart');
    if (event.key === 'End') return this.consumeMove('lineEnd');

    if (event.key === 'Backspace') {
      this.deleteBackward();
      return true;
    }
    if (event.key === 'Delete') {
      this.deleteForward();
      return true;
    }
    if (event.key === 'Enter') {
      this.insertText('\n');
      return true;
    }

    if (!primaryModifier && !event.altKey && event.key.length === 1) {
      this.insertText(event.key);
      return true;
    }

    return false;
  }

  /** Inserts committed text from IME/beforeinput events. Returns true when consumed. */
  public handleTextInput(text: string): boolean {
    if (!text) return false;
    this.insertText(text);
    return true;
  }

  /** Handles pointer down in editor local coordinates. */
  public handleMouseDown(x: number, y: number, shiftKey: boolean): void {
    if (shiftKey) {
      const index = this.cursorLogic.hitTest(x, y);
      if (index < 0) return;
      this.cursorLogic.setSelectionWithDirection(this.selectionStart, index);
    } else {
      if (!this.cursorLogic.moveToClick(x, y)) return;
    }

    this.isDragging = true;
    this.syncStateFromCursor();
    this.emit('cursorMove');
    this.emit('selectionChange');
  }

  /** Handles pointer move during drag selection. */
  public handleMouseMove(x: number, y: number): void {
    if (!this.isDragging) return;
    this.cursorLogic.updateSelectionDrag(x, y);
    this.syncStateFromCursor();
    this.emit('selectionChange');
  }

  /** Handles pointer release. */
  public handleMouseUp(): void {
    this.isDragging = false;
  }

  /** Handles double click to select current word. */
  public handleDoubleClick(x: number, y: number): void {
    const index = this.cursorLogic.hitTest(x, y);
    if (index < 0) return;

    const chars = this.getChars();
    let start = index;
    let end = index;

    while (start > 0 && !/\s/.test(chars[start - 1] ?? '')) start -= 1;
    while (end < chars.length && !/\s/.test(chars[end] ?? '')) end += 1;

    this.cursorLogic.setSelection(start, end);
    this.cursorLogic.moveTo(end);
    this.syncStateFromCursor();
    this.emit('selectionChange');
  }

  /** Per-frame update. Call in animation loop. */
  public update(): void {
    const cursorState = this.cursorLogic.getCursorState();
    const selection = this.cursorLogic.getSelection();
    const cursorRenderState = this.getActiveCursorRenderState(cursorState.position, cursorState.lineInfo.height);

    const selectedBoxes = this.cursorLogic.getSelectedCharBoxes();
    this.cursorRenderer.updateCursor(cursorRenderState.position, cursorRenderState.height);
    this.cursorRenderer.updateSelection(selectedBoxes);
    this.cursorRenderer.updateDebugInfo({
      containerBox: this.layoutContainer,
      charBoxes: this.cursorLogic.getCharBoxes(),
      chars: this.getChars(),
      lines: this.cursorLogic.getLines()
    });
    this.cursorRenderer.setSelectionStyle({
      fillColor: selection?.isBackwards ? 'rgba(150,0,255,0.25)' : 'rgba(0,120,255,0.30)'
    });
    this.cursorRenderer.render();
    this.updateImeAnchorPosition();
    this.updateToolbarPosition();
  }

  /** Releases all allocated resources. */
  public dispose(): void {
    if (MTextInputBox.activeEditor === this) {
      this.deactivateEditor();
    } else {
      this.detachIme();
    }
    this.detachPointerInteractions();
    this.unbindReopenDoubleClick();
    this.disposeRenderedObject(this.renderedObject);
    this.renderedObject = null;
    this.disposeBoundingBox();
    this.mtextRenderer.destroy();
    this.cursorRenderer.dispose();
    this.cursorLogic.destroy();
    this.handlers.change.clear();
    this.handlers.selectionChange.clear();
    this.handlers.cursorMove.clear();
    this.handlers.show.clear();
    this.handlers.close.clear();
    MTextInputBox.instances.delete(this);
    if (MTextInputBox.instances.size === 0) {
      MTextInputBox.sharedToolbar?.dispose();
      MTextInputBox.sharedToolbar = null;
      MTextInputBox.sharedToolbarContainer = null;
      MTextInputBox.sharedToolbarFontFamiliesKey = '';
      MTextInputBox.activeEditor = null;
    }
  }

  /** Closes editing interactions and destroys toolbar while keeping rendered text object. */
  public closeEditor(): void {
    if (this.closed) return;
    this.closed = true;
    this.detachPointerInteractions();
    this.deactivateEditor();
    this.emit('close');
  }

  /** Re-opens a closed editor and restores IME/pointer interactions and toolbar. */
  public showEditor(): boolean {
    const target = this.lastImeTarget;
    if (!target) return false;
    const wasClosed = this.closed;
    this.closed = false;
    this.attachPointerInteractions(target);
    this.activateEditor();
    if (wasClosed) this.emit('show');
    return true;
  }

  /** Binds built-in mouse interactions using the editor target element. */
  public attachPointerInteractions(target: HTMLElement): void {
    this.detachPointerInteractions();
    this.pointerTarget = target;
    target.addEventListener('mousedown', this.onPointerMouseDown);
    target.addEventListener('mousemove', this.onPointerMouseMove);
    target.addEventListener('dblclick', this.onPointerDoubleClick);
    window.addEventListener('mouseup', this.onPointerMouseUp);
  }

  /** Unbinds built-in mouse interactions. */
  public detachPointerInteractions(): void {
    if (!this.pointerTarget) return;
    this.pointerTarget.removeEventListener('mousedown', this.onPointerMouseDown);
    this.pointerTarget.removeEventListener('mousemove', this.onPointerMouseMove);
    this.pointerTarget.removeEventListener('dblclick', this.onPointerDoubleClick);
    window.removeEventListener('mouseup', this.onPointerMouseUp);
    this.pointerTarget = null;
  }

  /** Registers event handler. */
  public on(event: MTextInputBoxEvent, handler: Handler): void {
    this.handlers[event].add(handler);
  }

  /** Removes event handler. */
  public off(event: string, handler: Handler): void {
    if (
      event === 'change' ||
      event === 'selectionChange' ||
      event === 'cursorMove' ||
      event === 'show' ||
      event === 'close'
    ) {
      this.handlers[event].delete(handler);
    }
  }

  /** Returns cursor world position for IME/caret anchoring. */
  public getCursorWorldPosition(): { x: number; y: number; z: number } {
    const cursor = this.cursorLogic.getCursorState().position;
    return {
      x: this.position.x + cursor.x,
      y: this.position.y + cursor.y,
      z: this.position.z
    };
  }

  /** Returns current internal state snapshot. */
  public getState(): EditorState {
    return {
      mtextString: this.getText(),
      cursorIndex: this.cursorIndex,
      selectionStart: this.selectionStart,
      selectionEnd: this.selectionEnd,
      currentFormat: this.getCurrentFormat()
    };
  }

  private isActiveEditor(): boolean {
    return MTextInputBox.activeEditor === this;
  }

  private activateEditor(): void {
    if (this.closed) return;

    const currentActive = MTextInputBox.activeEditor;
    if (currentActive && currentActive !== this) {
      currentActive.deactivateEditor();
    }
    MTextInputBox.activeEditor = this;

    const target = this.imeTarget ?? this.lastImeTarget;
    if (target) {
      this.attachImeBridge(target);
    }

    this.cursorRenderer.show();
    if (this.boundingBoxObject) this.boundingBoxObject.visible = true;

    if (target && this.toolbarEnabled) {
      this.mountToolbar(target);
    } else {
      MTextInputBox.sharedToolbar?.setVisible(false);
    }
  }

  private deactivateEditor(): void {
    this.isDragging = false;
    this.detachIme();
    this.cursorRenderer.hide();
    if (this.boundingBoxObject) this.boundingBoxObject.visible = false;

    if (MTextInputBox.activeEditor === this) {
      MTextInputBox.activeEditor = null;
      MTextInputBox.sharedToolbar?.setVisible(false);
    }
  }

  private attachImeBridge(target: HTMLElement): void {
    this.detachIme();
    this.imeTarget = target;

    const imeInput = document.createElement('textarea');
    imeInput.setAttribute('aria-hidden', 'true');
    imeInput.autocapitalize = 'off';
    imeInput.autocomplete = 'off';
    imeInput.spellcheck = false;
    imeInput.style.position = 'fixed';
    imeInput.style.left = '0px';
    imeInput.style.top = '0px';
    imeInput.style.width = '2px';
    imeInput.style.height = '2px';
    imeInput.style.opacity = '0';
    imeInput.style.pointerEvents = 'none';
    imeInput.style.zIndex = '2147483647';

    document.body.appendChild(imeInput);
    this.imeInput = imeInput;

    imeInput.addEventListener('keydown', this.onImeKeyDown);
    imeInput.addEventListener('beforeinput', this.onImeBeforeInput as EventListener);
    imeInput.addEventListener('compositionstart', this.onImeCompositionStart);
    imeInput.addEventListener('compositionend', this.onImeCompositionEnd as EventListener);
    window.addEventListener('keydown', this.onWindowKeyDown);
    target.addEventListener('mousedown', this.onImeTargetMouseDown);

    this.updateImeAnchorPosition();
    this.focusImeInput();
  }

  private getActiveToolbar(): MTextToolbar | null {
    if (!this.isActiveEditor()) return null;
    const toolbar = MTextInputBox.sharedToolbar;
    if (!toolbar) {
      throw new Error('[mtext-input-box] Failed to create shared toolbar');
    }
    return toolbar;
  }

  private createToolbarSessionOptions(target: HTMLElement): ToolbarSessionOptions {
    return {
      anchorElement: target,
      onFormatChange: (partial) => {
        this.setCurrentFormat(partial);
      },
      onToggleStack: () => {
        this.toggleStackSelection();
      },
      onToggleSuperscript: () => {
        return this.toggleScriptSelection('superscript');
      },
      onToggleSubscript: () => {
        return this.toggleScriptSelection('subscript');
      }
    };
  }

  private ensureSharedToolbar(target: HTMLElement): MTextToolbar {
    const container = this.toolbarContainer ?? document.body;
    const fontFamiliesKey = this.toolbarFontFamilies?.join('\u0000') ?? '';
    const shouldRecreate =
      !MTextInputBox.sharedToolbar ||
      MTextInputBox.sharedToolbarContainer !== container ||
      MTextInputBox.sharedToolbarFontFamiliesKey !== fontFamiliesKey;

    if (shouldRecreate) {
      MTextInputBox.sharedToolbar?.dispose();

      const toolbarOptions: ToolbarOptions = {
        ...this.createToolbarSessionOptions(target),
        container,
        theme: this.toolbarTheme
      };
      if (this.toolbarFontFamilies) {
        toolbarOptions.fontFamilies = this.toolbarFontFamilies;
      }
      MTextInputBox.sharedToolbar = new MTextToolbar(toolbarOptions);
      MTextInputBox.sharedToolbarContainer = container;
      MTextInputBox.sharedToolbarFontFamiliesKey = fontFamiliesKey;
    }

    const toolbar = MTextInputBox.sharedToolbar;
    if (!toolbar) {
      throw new Error('[mtext-input-box] Failed to create shared toolbar');
    }
    return toolbar;
  }

  private mountToolbar(target: HTMLElement): void {
    if (!this.toolbarEnabled || !this.isActiveEditor()) return;

    const toolbar = this.ensureSharedToolbar(target);
    toolbar.setTheme(this.toolbarTheme);
    toolbar.setSession(this.createToolbarSessionOptions(target));
    toolbar.setVisible(true);
    toolbar.setFormat(this.currentFormat);
    this.updateToolbarStackState();
    this.updateToolbarPosition();
  }

  private updateToolbarPosition(): void {
    if (!this.toolbarEnabled || !this.isActiveEditor() || !this.imeTarget) return;
    const toolbar = this.getActiveToolbar();
    if (!toolbar) return;

    const bounds = this.getEditorScreenBounds();
    if (!bounds) return;

    toolbar.setAnchor(bounds.minX, bounds.minY - this.toolbarOffsetY);
  }

  private getEditorScreenBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (!this.imeTarget) return null;

    const rect = this.imeTarget.getBoundingClientRect();
    const x0 = this.position.x + this.layoutContainer.x;
    const x1 = x0 + this.layoutContainer.width;
    const y0 = this.position.y + this.layoutContainer.y;
    const y1 = y0 + this.layoutContainer.height;

    const corners = [
      new THREE.Vector3(x0, y0, this.position.z),
      new THREE.Vector3(x1, y0, this.position.z),
      new THREE.Vector3(x0, y1, this.position.z),
      new THREE.Vector3(x1, y1, this.position.z)
    ];

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const corner of corners) {
      const projected = corner.clone().project(this.camera);
      const sx = rect.left + ((projected.x + 1) * 0.5) * rect.width;
      const sy = rect.top + ((1 - projected.y) * 0.5) * rect.height;

      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { minX, maxX, minY, maxY };
  }

  private pointerEventToEditorLocal(event: MouseEvent): { x: number; y: number } | null {
    const target = this.pointerTarget ?? this.imeTarget;
    return this.pointerEventToEditorLocalByTarget(event, target);
  }

  private pointerEventToEditorLocalByTarget(
    event: MouseEvent,
    target: HTMLElement | null
  ): { x: number; y: number } | null {
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const nearPoint = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const farPoint = new THREE.Vector3(ndcX, ndcY, 1).unproject(this.camera);
    const rayDir = farPoint.sub(nearPoint);

    if (Math.abs(rayDir.z) < 1e-8) return null;

    const t = (this.position.z - nearPoint.z) / rayDir.z;
    const world = nearPoint.add(rayDir.multiplyScalar(t));
    return {
      x: world.x - this.position.x,
      y: world.y - this.position.y
    };
  }

  private shouldReopenFromDoubleClick(event: MouseEvent): boolean {
    return this.hitTestRenderedObject(event);
  }

  private hitTestRenderedObject(event: MouseEvent): boolean {
    if (!this.renderedObject || !this.reopenTarget) return false;
    const rect = this.reopenTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return raycaster.intersectObject(this.renderedObject, true).length > 0;
  }

  private bindReopenDoubleClick(target: HTMLElement): void {
    if (this.reopenTarget === target) return;
    this.unbindReopenDoubleClick();
    this.reopenTarget = target;
    target.addEventListener('dblclick', this.onReopenDoubleClick);
  }

  private unbindReopenDoubleClick(): void {
    if (!this.reopenTarget) return;
    this.reopenTarget.removeEventListener('dblclick', this.onReopenDoubleClick);
    this.reopenTarget = null;
  }

  private isPointInContainer(x: number, y: number): boolean {
    const box = this.layoutContainer;
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    return x >= box.x && x <= right && y >= box.y && y <= bottom;
  }

  private async initializeRenderer(): Promise<void> {
    try {
      await this.mtextRenderer.loadFonts(['simkai']);
      this.rendererReady = true;
      this.relayout();
    } catch (error) {
      console.error('[mtext-input-box] Failed to initialize mtext renderer fonts', error);
    }
  }

  private relayout(): void {
    if (!this.rendererReady) {
      const fallback = this.createFallbackCharBoxes();
      this.layoutContainer = fallback.containerBox;
      this.updateCursorData(fallback.charBoxes, fallback.lineBreakIndices, fallback.lineLayouts);
      this.updateBoundingBoxGeometry();
      return;
    }

    try {
      const mtextData = this.createMTextData();
      const style = this.createTextStyle();
      const object = this.mtextRenderer.syncRenderMText(
        mtextData,
        style,
        {
          byLayerColor: 0xffffff,
          byBlockColor: 0xffffff
        }
      );

      this.replaceRenderedObject(object);

      const rendered = this.extractBoxesFromRenderedObject(object);
      this.normalizeRenderedTopAlignment(object, rendered);
      this.layoutContainer = rendered.containerBox;
      this.updateCursorData(rendered.charBoxes, rendered.lineBreakIndices, rendered.lineLayouts);
      this.updateBoundingBoxGeometry();
    } catch (error) {
      console.error('[mtext-input-box] Failed to sync render MTEXT', error);
      const fallback = this.createFallbackCharBoxes();
      this.layoutContainer = fallback.containerBox;
      this.updateCursorData(fallback.charBoxes, fallback.lineBreakIndices, fallback.lineLayouts);
      this.updateBoundingBoxGeometry();
    }
  }

  private updateCursorData(
    charBoxes: Box[],
    lineBreakIndices?: number[],
    lineLayouts?: LineLayoutInput[]
  ): void {
    this.latestCursorLayoutData = {
      containerBox: { ...this.layoutContainer },
      charBoxes: charBoxes.map((box) => ({ ...box })),
      ...(lineBreakIndices ? { lineBreakIndices: [...lineBreakIndices] } : {}),
      ...(lineLayouts ? { lineLayouts: lineLayouts.map((line) => ({ ...line })) } : {})
    };
    this.cursorLogic.updateData(this.layoutContainer, charBoxes, lineBreakIndices, lineLayouts);
    const nextIndex = Math.min(this.cursorIndex, this.charCount());
    const maxLineIndex = Math.max(0, this.cursorLogic.getLineCount() - 1);
    const pendingLineHint =
      this.pendingCursorLineHint === null ? null : Math.max(0, Math.min(this.pendingCursorLineHint, maxLineIndex));
    this.pendingCursorLineHint = null;
    this.cursorLogic.moveTo(nextIndex, pendingLineHint);

    if (this.selectionStart !== this.selectionEnd) {
      this.cursorLogic.setSelection(this.selectionStart, this.selectionEnd);
    } else {
      this.cursorLogic.clearSelection();
    }

    this.syncStateFromCursor();
  }

  private extractBoxesFromRenderedObject(object: MTextObject): CursorLayoutData {
    const layout = object.createLayoutData();
    const charBoxes: Box[] = [];
    const lineLayouts: LineLayoutInput[] = (layout?.lines ?? [])
      .filter((line) => Number.isFinite(line.y) && Number.isFinite(line.height))
      .map((line) => ({
        y: line.y - this.position.y,
        height: Math.max(1, line.height)
      }));

    for (const entry of layout?.chars ?? []) {
      const localBox = entry.box ? this.toLocalBox(entry.box) : undefined;
      if (!localBox) continue;
      const isFiniteBox =
        Number.isFinite(localBox.x) &&
        Number.isFinite(localBox.y) &&
        Number.isFinite(localBox.width) &&
        Number.isFinite(localBox.height);
      if (!isFiniteBox) continue;
      charBoxes.push(localBox);
    }
    const lineBreakIndices = (layout.lines ?? [])
      .map((line) => line.breakIndex)
      .filter((value): value is number => Number.isInteger(value))
      .filter((value) => value >= 0 && value <= charBoxes.length);

    const local = this.toLocalBox(object.box);
    let containerTop = local.y - local.height / 2;
    let containerBottom = local.y + local.height / 2;

    if (lineLayouts.length > 0) {
      for (const line of lineLayouts) {
        const top = line.y - line.height / 2;
        const bottom = line.y + line.height / 2;
        containerTop = Math.min(containerTop, top);
        containerBottom = Math.max(containerBottom, bottom);
      }
    }

    const containerBox = {
      x: local.x,
      y: containerTop,
      width: local.width,
      height: Math.max(0, containerBottom - containerTop)
    };
    containerBox.x = 0;
    containerBox.width = this.width;
    containerBox.height = Math.max(containerBox.height, this.getFallbackLineAdvance());

    return {
      containerBox,
      charBoxes,
      ...(lineBreakIndices.length > 0 ? { lineBreakIndices } : {}),
      ...(lineLayouts.length > 0 ? { lineLayouts } : {})
    };
  }

  private normalizeRenderedTopAlignment(
    object: MTextObject,
    rendered: CursorLayoutData
  ): void {
    const dy = -rendered.containerBox.y;
    if (!Number.isFinite(dy) || Math.abs(dy) < 1e-8) return;

    object.position.y += dy;
    object.updateMatrixWorld(true);

    rendered.containerBox.y += dy;
    rendered.charBoxes.forEach((box) => {
      box.y += dy;
    });
    rendered.lineLayouts?.forEach((line) => {
      line.y += dy;
    });
  }

  private toLocalBox(worldBox: THREE.Box3): Box {
    const minX = worldBox.min.x - this.position.x;
    const maxX = worldBox.max.x - this.position.x;
    const minY = worldBox.min.y - this.position.y;
    const maxY = worldBox.max.y - this.position.y;

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);

    return {
      x: minX,
      y: minY + height / 2,
      width,
      height
    };
  }

  private createFallbackCharBoxes(): {
    containerBox: Box;
    charBoxes: Box[];
    lineBreakIndices: number[];
    lineLayouts: LineLayoutInput[];
  } {
    const lineHeight = this.getFallbackLineAdvance();
    const charBoxes: Box[] = [];
    const lineBreakIndices: number[] = [];
    const lineLayouts: LineLayoutInput[] = [];

    let x = 0;
    let y = 0;
    let maxY = lineHeight;
    lineLayouts.push({ y: y + lineHeight / 2, height: lineHeight });

    for (const char of this.getChars()) {
      if (char === '\n') {
        lineBreakIndices.push(charBoxes.length);
        x = 0;
        y += lineHeight;
        maxY = Math.max(maxY, y + lineHeight);
        lineLayouts.push({ y: y + lineHeight / 2, height: lineHeight });
        continue;
      }

      const width = Math.max(1, this.currentFormat.fontSize * 0.6);
      if (this.enableWordWrap && x > 0 && x + width > this.width) {
        lineBreakIndices.push(charBoxes.length);
        x = 0;
        y += lineHeight;
      }

      charBoxes.push({ x, y: y + lineHeight / 2, width, height: lineHeight });
      x += width;
      maxY = Math.max(maxY, y + lineHeight);
    }

    return {
      containerBox: {
        x: 0,
        y: 0,
        width: this.width,
        height: Math.max(1, maxY)
      },
      charBoxes,
      lineBreakIndices,
      lineLayouts
    };
  }

  private createBoundingBox(enabled: boolean, style?: MTextBoundingBoxStyle): void {
    if (!enabled) return;

    const color = typeof style?.color === 'number' ? style.color : new THREE.Color(style?.color ?? '#58a6ff');
    this.boundingBoxPadding = Math.max(0, style?.padding ?? 1);
    this.boundingBoxZOffset = style?.zOffset ?? 0.01;
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: style?.opacity ?? 0.9,
      depthTest: false,
      depthWrite: false
    });

    const geometry = new THREE.BufferGeometry();
    this.boundingBoxObject = new THREE.LineLoop(geometry, material);
    this.boundingBoxObject.position.z = this.boundingBoxZOffset;
    this.scene.add(this.boundingBoxObject);
  }

  private updateBoundingBoxGeometry(): void {
    if (!this.boundingBoxObject) return;

    const existing = this.boundingBoxObject.geometry as THREE.BufferGeometry;
    existing.dispose();

    const padding = this.boundingBoxPadding;
    const minX = this.position.x + this.layoutContainer.x - padding;
    const minY = this.position.y + this.layoutContainer.y - padding;
    const maxX = this.position.x + this.layoutContainer.x + this.layoutContainer.width + padding;
    const maxY = this.position.y + this.layoutContainer.y + this.layoutContainer.height + padding;
    const z = this.position.z;

    this.boundingBoxObject.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, minY, z),
      new THREE.Vector3(maxX, minY, z),
      new THREE.Vector3(maxX, maxY, z),
      new THREE.Vector3(minX, maxY, z)
    ]);
  }

  private disposeBoundingBox(): void {
    if (!this.boundingBoxObject) return;
    this.boundingBoxObject.removeFromParent();
    this.boundingBoxObject.geometry.dispose();
    const materials = Array.isArray(this.boundingBoxObject.material)
      ? this.boundingBoxObject.material
      : [this.boundingBoxObject.material];
    for (const material of materials) {
      material.dispose();
    }
    this.boundingBoxObject = null;
  }

  private replaceRenderedObject(object: MTextObject): void {
    this.disposeRenderedObject(this.renderedObject);
    this.forceVisibleMaterialState(object);
    this.renderedObject = object;
    this.scene.add(object);
  }

  private forceVisibleMaterialState(object: MTextObject): void {
    object.traverse((child: THREE.Object3D) => {
      const meshLike = child as THREE.Mesh;
      const materials = (meshLike.material
        ? Array.isArray(meshLike.material)
          ? meshLike.material
          : [meshLike.material]
        : []) as THREE.Material[];

      for (const mat of materials) {
        const m = mat as THREE.Material & {
          side?: THREE.Side;
          depthTest?: boolean;
          depthWrite?: boolean;
          transparent?: boolean;
          opacity?: number;
        };

        if (typeof m.side !== "undefined") m.side = THREE.DoubleSide;
        if (typeof m.depthTest !== "undefined") m.depthTest = false;
        if (typeof m.depthWrite !== "undefined") m.depthWrite = false;
        if (typeof m.transparent !== "undefined" && typeof m.opacity !== "undefined") {
          m.transparent = m.opacity < 1;
        }
        m.needsUpdate = true;
      }
    });
  }

  private disposeRenderedObject(object: MTextObject | null): void {
    if (!object) return;
    object.removeFromParent();

    const withDispose = object as MTextObject & { dispose?: () => void };
    if (typeof withDispose.dispose === 'function') {
      withDispose.dispose();
      return;
    }

    object.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const materials = (mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []) as THREE.Material[];
      for (const material of materials) {
        const withMap = material as THREE.Material & { map?: THREE.Texture };
        if (withMap.map) withMap.map.dispose();
        material.dispose();
      }
    });
  }


  private isExplicitAci(aci: number | null): aci is number {
    return aci !== null && Number.isInteger(aci) && aci > 0 && aci < 256;
  }

  private normalizeColorNumber(color: number): number {
    return Math.max(0, Math.min(0xffffff, Math.round(color)));
  }

  private resolveAciColor(aci: number): number {
    const value = getColorByIndex(aci);
    return this.normalizeColorNumber(Number.isFinite(value) ? value : 0xffffff);
  }

  private resolveBaseColor(): number {
    if (this.isExplicitAci(this.baseFormat.aci)) {
      return this.resolveAciColor(this.baseFormat.aci);
    }
    if (this.baseFormat.rgb !== null) {
      return this.normalizeColorNumber(this.baseFormat.rgb);
    }
    return 0xffffff;
  }

  private resolveFormatColorNumber(format: CharFormat): number {
    return this.isExplicitAci(format.aci)
      ? this.resolveAciColor(format.aci)
      : format.rgb !== null
        ? this.normalizeColorNumber(format.rgb)
        : 0xffffff;
  }
  private createDefaultTextStyle(): TextStyle {
    const baseSize = Math.max(1, this.baseFormat.fontSize);
    return {
      name: 'MTextInputBoxStyle',
      standardFlag: 0,
      fixedTextHeight: baseSize,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: baseSize,
      font: this.baseFormat.fontFamily || 'simkai',
      bigFont: '',
      color: this.resolveFormatColorNumber(this.baseFormat)
    };
  }

  private createMTextData(): MTextData {
    return {
      text: this.mtextString,
      height: Math.max(1, this.defaultTextStyle.fixedTextHeight),
      width: this.width,
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z
      },
      attachmentPoint: MTextAttachmentPoint.TopLeft,
      drawingDirection: MTextFlowDirection.LEFT_TO_RIGHT,
      widthFactor: 1,
      collectCharBoxes: true
    };
  }

  private getFallbackLineAdvance(): number {
    return Math.max(1, this.currentFormat.fontSize * MTextInputBox.FALLBACK_LINE_ADVANCE_RATIO);
  }

  private createTextStyle(): TextStyle {
    return { ...this.defaultTextStyle };
  }


  private focusImeInput(): void {
    if (!this.imeInput) return;
    this.imeInput.focus({ preventScroll: true });
  }

  private refocusImeInputSoon(): void {
    if (!this.imeInput) return;
    if (this.imeFocusTimer !== null) {
      window.clearTimeout(this.imeFocusTimer);
    }
    this.imeFocusTimer = window.setTimeout(() => {
      this.focusImeInput();
      this.imeFocusTimer = null;
    }, 0);
  }

  private updateImeAnchorPosition(): void {
    if (!this.imeInput || !this.imeTarget) return;

    const cursorWorld = this.getCursorWorldPosition();
    const world = new THREE.Vector3(cursorWorld.x, cursorWorld.y, cursorWorld.z);
    const projected = world.project(this.camera);
    const rect = this.imeTarget.getBoundingClientRect();

    const x = rect.left + ((projected.x + 1) * 0.5) * rect.width;
    const y = rect.top + ((1 - projected.y) * 0.5) * rect.height;

    this.imeInput.style.left = `${Math.round(x)}px`;
    this.imeInput.style.top = `${Math.round(y)}px`;
  }

  private syncStateFromCursor(): void {
    this.cursorIndex = this.cursorLogic.getCurrentIndex();
    const selection = this.cursorLogic.getSelection();
    if (!selection) {
      this.selectionStart = this.cursorIndex;
      this.selectionEnd = this.cursorIndex;
    } else {
      this.selectionStart = selection.start;
      this.selectionEnd = selection.end;
    }
    this.syncDocumentFromUiState();
    this.refreshCurrentFormatFromDocument();
  }

  private consumeMove(direction: CursorDirection): boolean {
    this.moveCursor(direction);
    return true;
  }

  private consumeExtend(direction: SelectionDirection): boolean {
    this.extendSelection(direction);
    return true;
  }

  private isMacPlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  }

  private emit(event: MTextInputBoxEvent): void {
    for (const handler of this.handlers[event]) handler();
  }

  private findPrevWordStart(index: number): number {
    const chars = this.getChars();
    let i = Math.max(0, index - 1);
    while (i > 0 && /\s/.test(chars[i] ?? '')) i -= 1;
    while (i > 0 && !/\s/.test(chars[i - 1] ?? '')) i -= 1;
    return i;
  }

  private findNextWordStart(index: number): number {
    const chars = this.getChars();
    let i = Math.min(chars.length, index);
    while (i < chars.length && !/\s/.test(chars[i] ?? '')) i += 1;
    while (i < chars.length && /\s/.test(chars[i] ?? '')) i += 1;
    return i;
  }

  private getChars(): string[] {
    const chars: string[] = [];
    for (const node of this.document.ast.nodes) {
      if (node.type === 'char') {
        chars.push(node.value);
        continue;
      }
      if (node.type === 'stack') {
        chars.push('');
        continue;
      }
      if (node.type === 'paragraphBreak' || node.type === 'columnBreak' || node.type === 'wrapAtDimLine') {
        chars.push('\n');
      }
    }
    return chars;
  }

  private charCount(): number {
    return this.getChars().length;
  }

  private getActiveCursorRenderState(
    fallbackPosition: { x: number; y: number },
    fallbackHeight: number
  ): { position: { x: number; y: number }; height: number } {
    const boxes = this.cursorLogic.getCharBoxes();
    const index = this.cursorLogic.getCurrentIndex();
    const line = this.cursorLogic.getCurrentLineInfo();
    if (boxes.length === 0) {
      // Empty-content bootstrap path.
      //
      // Why this exists:
      // - For a brand new/empty MTEXT, there are no glyph boxes yet.
      // - In that state, TextBoxCursor falls back to its container line info.
      // - Depending on renderer output, that fallback Y can represent the whole
      //   container center instead of the first editable line center, so the
      //   caret appears visually lower than the top line area.
      //
      // Goal:
      // - Anchor caret to the first editable line, not to the entire empty box.
      // - Keep X from cursor logic (fallbackPosition.x), only correct Y/height.
      const firstLine = this.latestCursorLayoutData.lineLayouts?.[0];
      if (firstLine && Number.isFinite(firstLine.y) && Number.isFinite(firstLine.height)) {
        const lineHeight = Math.max(1, firstLine.height);
        return {
          // Best source: renderer-provided line layout already represents
          // the actual first-line center in editor local coordinates.
          position: { x: fallbackPosition.x, y: firstLine.y },
          height: Math.max(1, lineHeight * 0.8)
        };
      }

      const inferredLineHeight = Math.max(1, this.getFallbackLineAdvance());
      return {
        position: {
          x: fallbackPosition.x,
          // When explicit line layout is unavailable, infer first-line center
          // from top-left container coordinates:
          //   lineCenterY = containerTopY + lineHeight / 2
          // This keeps caret aligned with the top row for empty MTEXT.
          y: this.layoutContainer.y + inferredLineHeight / 2
        },
        height: Math.max(1, inferredLineHeight * 0.8)
      };
    }

    // At a line-start gap (including wrapped/paragraph boundaries), rely on
    // cursor logic line-hint rather than previous glyph box.
    if (index <= 0 || index === line.startIndex) {
      const isEmptyLine = line.charCount <= 0 || line.endIndex < line.startIndex;
      if (!isEmptyLine) {
        const firstIndex = Math.max(0, Math.min(line.startIndex, boxes.length - 1));
        const first = boxes[firstIndex];
        if (first) {
          return {
            position: { x: fallbackPosition.x, y: first.y },
            height: Math.max(1, first.height)
          };
        }
      }

      const emptyLineHeight = (line.height ?? fallbackHeight) * 0.8;
      return {
        position: { x: fallbackPosition.x, y: line.y ?? fallbackPosition.y },
        height: Math.max(1, emptyLineHeight)
      };
    }

    const prev = boxes[Math.min(index - 1, boxes.length - 1)];
    if (!prev) {
      return {
        position: fallbackPosition,
        height: Math.max(1, fallbackHeight)
      };
    }

    return {
      position: { x: prev.x + prev.width, y: prev.y },
      height: Math.max(1, prev.height)
    };
  }

  private getNodeLogicalSpan(node: MTextAst["nodes"][number]): number {
    switch (node.type) {
      case "char":
        return 1;
      case "stack":
        return 1;
      case "paragraphBreak":
      case "columnBreak":
      case "wrapAtDimLine":
        // Structural line-break nodes do not have a visual char box, so
        // they must not consume logical cursor positions.
        return 0;
      default:
        return 0;
    }
  }

  private toLogicalIndexFromDocumentIndex(documentIndex: number): number {
    const safeIndex = Math.max(0, Math.min(documentIndex, this.document.ast.nodes.length));
    let logical = 0;
    for (let i = 0; i < safeIndex; i += 1) {
      const node = this.document.ast.nodes[i];
      if (!node) continue;
      logical += this.getNodeLogicalSpan(node);
    }
    return logical;
  }

  private toDocumentIndexFromLogicalIndex(
    logicalIndex: number,
    preferAfterZeroSpan: boolean = true,
    lineIndexHint?: number
  ): number {
    const nodes = this.document.ast.nodes;
    if (nodes.length === 0) return 0;

    const maxLogical = this.charCount();
    const targetLogical = Math.max(0, Math.min(logicalIndex, maxLogical));
    const candidates: { index: number; lineIndex: number }[] = [];
    let logical = 0;
    let lineIndex = 0;

    for (let i = 0; i <= nodes.length; i += 1) {
      if (logical === targetLogical) {
        candidates.push({ index: i, lineIndex });
      }
      if (i === nodes.length) break;
      const node = nodes[i];
      if (!node) continue;
      const span = this.getNodeLogicalSpan(node);
      if (span === 0) {
        lineIndex += 1;
      } else {
        logical += span;
      }
    }

    if (candidates.length === 0) return nodes.length;

    if (lineIndexHint !== undefined && Number.isFinite(lineIndexHint)) {
      const self = this as unknown as {
        resolveCandidateByVisualLineHint?: (
          candidates: { index: number; lineIndex: number }[],
          logicalIndex: number,
          lineIndexHint: number
        ) => number | undefined;
      };
      const resolveCandidateByVisualLineHint =
        typeof self.resolveCandidateByVisualLineHint === 'function'
          ? self.resolveCandidateByVisualLineHint
          : MTextInputBox.prototype.resolveCandidateByVisualLineHint;
      const visualMatch = resolveCandidateByVisualLineHint.call(
        this,
        candidates,
        targetLogical,
        lineIndexHint
      );
      if (visualMatch !== undefined) {
        return visualMatch;
      }

      const minCandidateLine = candidates[0]?.lineIndex ?? 0;
      const maxCandidateLine = candidates[candidates.length - 1]?.lineIndex ?? 0;
      if (lineIndexHint < minCandidateLine || lineIndexHint > maxCandidateLine) {
        return preferAfterZeroSpan ? candidates[candidates.length - 1]!.index : candidates[0]!.index;
      }

      let best = candidates[0]!;
      let bestDist = Math.abs(best.lineIndex - lineIndexHint);
      for (let i = 1; i < candidates.length; i += 1) {
        const candidate = candidates[i]!;
        const dist = Math.abs(candidate.lineIndex - lineIndexHint);
        if (dist < bestDist) {
          best = candidate;
          bestDist = dist;
        }
      }
      return best.index;
    }

    return preferAfterZeroSpan ? candidates[candidates.length - 1]!.index : candidates[0]!.index;
  }

  private resolveCandidateByVisualLineHint(
    candidates: { index: number; lineIndex: number }[],
    logicalIndex: number,
    lineIndexHint: number
  ): number | undefined {
    if (candidates.length <= 1) return undefined;
    if (this.cursorLogic == null || typeof this.cursorLogic.getLines !== 'function') return undefined;

    const lines = this.cursorLogic.getLines();
    if (!Array.isArray(lines) || lines.length === 0) return undefined;

    const visualMatches: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      if (logicalIndex >= line.startIndex && logicalIndex <= line.endIndex + 1) {
        visualMatches.push(i);
      }
    }

    if (visualMatches.length !== candidates.length) return undefined;
    const rank = visualMatches.indexOf(lineIndexHint);
    if (rank < 0) return undefined;
    const candidate = candidates[rank];
    return candidate?.index;
  }

  private syncUiStateFromDocument(): void {
    this.mtextString = this.document.toMText();

    const logicalLength = this.charCount();
    this.cursorIndex = Math.min(this.toLogicalIndexFromDocumentIndex(this.document.cursor), logicalLength);

    const selection = this.document.selection;
    if (selection) {
      this.selectionStart = this.toLogicalIndexFromDocumentIndex(selection.start);
      this.selectionEnd = this.toLogicalIndexFromDocumentIndex(selection.end);
    } else {
      this.selectionStart = this.cursorIndex;
      this.selectionEnd = this.cursorIndex;
    }
    this.refreshCurrentFormatFromDocument();
  }

  private syncDocumentFromUiState(): void {
    const selection = this.getSelectionRange();
    if (!selection.isCollapsed) {
      const start = this.toDocumentIndexFromLogicalIndex(selection.start, false);
      const end = this.toDocumentIndexFromLogicalIndex(selection.end, false);
      this.document.setSelection(start, end);
      return;
    }

    this.document.clearSelection();
    const cursorState = this.cursorLogic.getCursorState();
    const lineIndexHint = cursorState.lineIndex;
    const preferAfterZeroSpan = cursorState.isAtLineEnd && !cursorState.isAtLineStart ? false : true;
    this.document.cursor = this.toDocumentIndexFromLogicalIndex(
      this.cursorIndex,
      preferAfterZeroSpan,
      lineIndexHint >= 0 ? lineIndexHint : undefined
    );
  }

  private refreshCurrentFormatFromDocument(): void {
    const inferred = this.inferCurrentFormatFromDocument();
    this.updateToolbarStackState();
    if (!inferred) {
      this.getActiveToolbar()?.setFormat(this.currentFormat);
      return;
    }
    if (!sameFormat(this.currentFormat, inferred)) {
      this.currentFormat = inferred;
    }
    this.getActiveToolbar()?.setFormat(this.currentFormat);
  }

  private toggleStackSelection(): void {
    const selection = this.getSelectionRange();
    if (selection.isCollapsed) return;
    this.commitHistoryEdit(() => {
      this.syncDocumentFromUiState();

      const start = this.toDocumentIndexFromLogicalIndex(selection.start, false);
      const end = this.toDocumentIndexFromLogicalIndex(selection.end, false);
      if (end <= start) return;

      const selectedNodes = this.document.ast.nodes.slice(start, end);
      if (selectedNodes.length === 1 && selectedNodes[0]?.type === 'stack') {
        const stackNode = selectedNodes[0];
        const plainText = this.stackNodeToPlainText(stackNode.numerator, stackNode.denominator, stackNode.divider);
        const plainNodes = Array.from(plainText).map((char) => ({
          type: 'char' as const,
          value: char,
          style: this.cloneDocumentStyle(stackNode.style)
        }));
        if (plainNodes.length === 0) return;

        this.document.transaction((doc) => {
          doc.ast.nodes.splice(start, 1, ...plainNodes);
          doc.setSelection(start, start + plainNodes.length);
        });
        this.syncUiStateFromDocument();
        this.relayout();
        return;
      }

      if (!selectedNodes.every((node) => node?.type === 'char')) return;
      const plainText = selectedNodes.map((node) => node.value).join('');
      const stackParts = this.parseStackParts(plainText);
      if (!stackParts) return;

      const first = selectedNodes[0];
      if (!first) return;
      const stackNode = {
        type: 'stack' as const,
        numerator: stackParts.numerator,
        denominator: stackParts.denominator,
        divider: stackParts.divider,
        style: this.cloneDocumentStyle(first.style)
      };

      this.document.transaction((doc) => {
        doc.ast.nodes.splice(start, end - start, stackNode);
        doc.setSelection(start, start + 1);
      });
      this.syncUiStateFromDocument();
      this.relayout();
    });
  }

  private toggleScriptSelection(script: 'superscript' | 'subscript'): boolean {
    const selection = this.getSelectionRange();
    if (selection.isCollapsed) return false;
    let changed = false;
    this.commitHistoryEdit(() => {
      this.syncDocumentFromUiState();

      const start = this.toDocumentIndexFromLogicalIndex(selection.start, false);
      const end = this.toDocumentIndexFromLogicalIndex(selection.end, false);
      if (end <= start) return;

      const selectedNodes = this.document.ast.nodes.slice(start, end);
      if (selectedNodes.length === 1 && selectedNodes[0]?.type === 'stack') {
        const stackNode = selectedNodes[0];
        const plainText = this.scriptStackToPlainText(stackNode.numerator, stackNode.denominator, stackNode.divider);
        if (!plainText) return;

        const plainStyle = this.cloneDocumentStyle(stackNode.style);
        plainStyle.script = 'normal';
        plainStyle.align = MTextLineAlignment.MIDDLE;
        const plainNodes = Array.from(plainText).map((char) => ({
          type: 'char' as const,
          value: char,
          style: this.cloneDocumentStyle(plainStyle)
        }));
        if (plainNodes.length === 0) return;

        this.document.transaction((doc) => {
          doc.ast.nodes.splice(start, 1, ...plainNodes);
          doc.setSelection(start, start + plainNodes.length);
        });
        this.syncUiStateFromDocument();
        this.relayout();
        changed = true;
        return;
      }

      if (!selectedNodes.every((node) => node?.type === 'char')) return;
      const plainText = selectedNodes.map((node) => node.value).join('');
      if (plainText.length === 0) return;

      const first = selectedNodes[0];
      if (!first) return;

      const scriptStyle = this.cloneDocumentStyle(first.style);
      scriptStyle.script = script;
      scriptStyle.align = script === 'superscript' ? MTextLineAlignment.TOP : MTextLineAlignment.BOTTOM;

      const stackNode = {
        type: 'stack' as const,
        numerator: script === 'superscript' ? plainText : '',
        denominator: script === 'subscript' ? plainText : '',
        divider: '^' as const,
        style: this.cloneDocumentStyle(scriptStyle)
      };

      this.document.transaction((doc) => {
        doc.ast.nodes.splice(start, end - start, stackNode);
        doc.setSelection(start, start + 1);
      });
      this.syncUiStateFromDocument();
      this.relayout();
      changed = true;
    });
    return changed;
  }

  private commitHistoryEdit(edit: () => void): void {
    const before = this.createHistorySnapshot();
    edit();
    if (this.isSameAsCurrent(before)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.splice(0, this.undoStack.length - this.maxHistorySize);
    }
    this.redoStack = [];
    this.emit('change');
    this.emit('selectionChange');
    this.emit('cursorMove');
  }

  private createHistorySnapshot(): HistorySnapshot {
    return {
      ast: this.cloneAst(this.document.ast),
      cursor: this.document.cursor,
      selection: this.document.selection ? { ...this.document.selection } : null,
      currentFormat: { ...this.currentFormat }
    };
  }

  private restoreHistorySnapshot(snapshot: HistorySnapshot): void {
    this.document = new MTextDocument(this.cloneAst(snapshot.ast));
    if (snapshot.selection) {
      this.document.setSelection(snapshot.selection.start, snapshot.selection.end);
    } else {
      this.document.cursor = snapshot.cursor;
      this.document.clearSelection();
    }
    this.uiAdapter = new EditorUiAdapter(this.document);
    this.currentFormat = { ...snapshot.currentFormat };
    this.syncUiStateFromDocument();
    this.relayout();
    this.emit('change');
    this.emit('selectionChange');
    this.emit('cursorMove');
  }

  private isSameAsCurrent(snapshot: HistorySnapshot): boolean {
    if (snapshot.cursor !== this.document.cursor) return false;
    const selection = this.document.selection;
    if (!!snapshot.selection !== !!selection) return false;
    if (snapshot.selection && selection) {
      if (snapshot.selection.start !== selection.start || snapshot.selection.end !== selection.end) {
        return false;
      }
    }
    if (!sameFormat(snapshot.currentFormat, this.currentFormat)) return false;
    return this.document.toMText() === this.buildMTextFromAst(snapshot.ast);
  }

  private buildMTextFromAst(ast: MTextAst): string {
    return new MTextDocument(this.cloneAst(ast)).toMText();
  }

  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private cloneAst(ast: MTextAst): MTextAst {
    return {
      nodes: ast.nodes.map((node) => {
        if (node.type === 'char') {
          return { ...node, style: this.cloneDocumentStyle(node.style) };
        }
        if (node.type === 'stack') {
          return { ...node, style: this.cloneDocumentStyle(node.style) };
        }
        return { ...node, style: this.cloneDocumentStyle(node.style) };
      })
    };
  }

  private stackNodeToPlainText(numerator: string, denominator: string, divider: string): string {
    if (divider === '^') {
      if (numerator.length === 0 && denominator.length > 0) {
        return `^${denominator.trimStart()}`;
      }
      if (numerator.length > 0 && denominator.length === 0) {
        return `${numerator.trimEnd()}^`;
      }
    }
    return `${numerator}${divider}${denominator}`;
  }

  private scriptStackToPlainText(numerator: string, denominator: string, divider: string): string | null {
    if (divider !== '^') return null;
    const hasNumerator = numerator.trim().length > 0;
    const hasDenominator = denominator.trim().length > 0;
    if (hasNumerator === hasDenominator) return null;
    return hasNumerator ? numerator.trim() : denominator.trim();
  }

  private parseStackParts(
    plainText: string
  ): { numerator: string; denominator: string; divider: '/' | '#' | '^' } | null {
    const dividerIndices: { index: number; divider: '/' | '#' | '^' }[] = [];
    for (let i = 0; i < plainText.length; i += 1) {
      const char = plainText[i];
      if (char === '/' || char === '#' || char === '^') {
        dividerIndices.push({ index: i, divider: char });
      }
    }

    if (dividerIndices.length !== 1) return null;
    const dividerInfo = dividerIndices[0];
    if (!dividerInfo) return null;
    const { index, divider } = dividerInfo;
    const numerator = plainText.slice(0, index);
    const denominator = plainText.slice(index + 1);

    if (divider === '^') {
      const hasNumerator = numerator.trim().length > 0;
      const hasDenominator = denominator.trim().length > 0;
      if (!hasNumerator && !hasDenominator) return null;
      return { numerator, denominator, divider };
    }

    if (numerator.trim().length === 0 || denominator.trim().length === 0) return null;
    return { numerator, denominator, divider };
  }

  private updateToolbarStackState(): void {
    const toolbar = this.getActiveToolbar();
    if (!toolbar) return;

    const selection = this.getSelectionRange();
    if (selection.isCollapsed) {
      toolbar.setStackActive(false);
      return;
    }

    const start = this.toDocumentIndexFromLogicalIndex(selection.start, false);
    const end = this.toDocumentIndexFromLogicalIndex(selection.end, false);
    const selectedNodes = this.document.ast.nodes.slice(start, end);
    const active =
      selectedNodes.length === 1 &&
      selectedNodes[0]?.type === 'stack' &&
      !this.isScriptOnlyStack(selectedNodes[0]);
    toolbar.setStackActive(active);
  }

  private isScriptOnlyStack(node: { numerator: string; denominator: string; divider: string }): boolean {
    if (node.divider !== '^') return false;
    const hasNumerator = node.numerator.trim().length > 0;
    const hasDenominator = node.denominator.trim().length > 0;
    return hasNumerator !== hasDenominator;
  }

  private inferCurrentFormatFromDocument(): CharFormat | null {
    const nodes = this.document.ast.nodes;
    if (nodes.length === 0) return null;

    const logicalLength = this.getChars().length;
    if (logicalLength === 0) return null;

    const hasSelection = this.selectionStart !== this.selectionEnd;
    const anchorIndex = hasSelection
      ? Math.min(this.selectionStart, this.selectionEnd)
      : this.cursorIndex > 0
        ? this.cursorIndex - 1
        : 0;

    const node = this.getNodeByLogicalCharIndex(anchorIndex);
    if (!node) return null;

    return this.toCharFormat(node.style);
  }

  private getNodeByLogicalCharIndex(index: number): MTextAst['nodes'][number] | null {
    const nodes = this.document.ast.nodes;
    if (nodes.length === 0) return null;

    let offset = 0;
    const safeIndex = Math.max(0, index);

    for (const node of nodes) {
      const span = this.getNodeLogicalSpan(node);

      if (safeIndex < offset + span) {
        return node;
      }

      offset += span;
    }

    return nodes[nodes.length - 1] ?? null;
  }

  private getNodesByLogicalRange(start: number, end: number): MTextAst['nodes'] {
    const nodes = this.document.ast.nodes;
    if (nodes.length === 0) return [];

    const rangeStart = Math.max(0, Math.min(start, end));
    const rangeEnd = Math.max(rangeStart, Math.max(start, end));
    if (rangeStart === rangeEnd) return [];

    const selected: MTextAst['nodes'] = [];
    let offset = 0;

    for (const node of nodes) {
      const span = this.getNodeLogicalSpan(node);

      const nodeStart = offset;
      const nodeEnd = offset + span;
      if (span > 0 && nodeStart < rangeEnd && nodeEnd > rangeStart) {
        selected.push(node);
      }
      offset = nodeEnd;
    }

    return selected;
  }

  private toCharFormat(style: MTextStyle): CharFormat {
    const baseSize = Math.max(1, this.defaultTextStyle.fixedTextHeight);
    const capHeight = style.capHeight.isRelative
      ? baseSize * Math.max(0, style.capHeight.value)
      : style.capHeight.value;
    const defaultFontFamily = this.defaultTextStyle.font || this.baseFormat.fontFamily;

    const resolvedColor = style.rgb
      ? this.rgbArrayToColorNumber(style.rgb)
      : this.isExplicitAci(style.aci)
        ? this.resolveAciColor(style.aci)
        : this.resolveBaseColor();
    const resolvedAci = this.isExplicitAci(style.aci)
      ? style.aci
      : this.isExplicitAci(this.baseFormat.aci)
        ? this.baseFormat.aci
        : null;

    const script = this.toScriptFromStyle(style, baseSize, capHeight);
    const reducedThreshold = Math.max(1, baseSize) * 0.9;
    const isReducedScriptCapHeight = capHeight <= reducedThreshold;
    const logicalFontSize =
      script === 'normal' ? capHeight : isReducedScriptCapHeight ? capHeight / 0.7 : capHeight;

    return {
      fontFamily: style.fontFace.family || defaultFontFamily,
      fontSize: Math.max(1, logicalFontSize || baseSize),
      bold: style.fontFace.weight >= 700,
      italic: style.fontFace.style === 'Italic',
      underline: style.underline,
      overline: style.overline,
      strike: style.strikeThrough,
      script,
      aci: resolvedAci,
      rgb: resolvedColor
    };
  }
  private toScriptFromStyle(style: MTextStyle, baseSize: number, capHeight: number): CharFormat['script'] {
    if (style.script && style.script !== 'normal') {
      return style.script;
    }

    const reducedThreshold = Math.max(1, baseSize) * 0.9;
    const isReduced = capHeight <= reducedThreshold;

    if (isReduced && style.align === MTextLineAlignment.TOP) {
      return 'superscript';
    }
    if (isReduced && style.align === MTextLineAlignment.BOTTOM) {
      return 'subscript';
    }

    return 'normal';
  }

  private createDefaultParseContext(): MTextContext {
    const context = new MTextContext();
    context.fontFace.family = this.defaultTextStyle.font || this.baseFormat.fontFamily;
    context.fontFace.style = this.baseFormat.italic ? 'Italic' : 'Regular';
    context.fontFace.weight = this.baseFormat.bold ? 700 : 400;

    // Relative cap height keeps parser defaults aligned with editor base text height.
    context.capHeight = { value: 1, isRelative: true };
    context.align = MTextLineAlignment.MIDDLE;
    context.widthFactor = { value: this.defaultTextStyle.widthFactor ?? 1, isRelative: true };

    if (this.isExplicitAci(this.baseFormat.aci)) {
      context.aci = this.baseFormat.aci;
      context.rgb = null;
    } else {
      const color = this.resolveBaseColor();
      context.rgb = this.colorNumberToRgbArray(color);
      context.aci = 256;
    }

    return context;
  }

  private createNormalizedDocument(text: string): MTextDocument {
    const base = MTextDocument.fromMText(text, this.createDefaultParseContext());
    const normalizedAst: MTextAst = { nodes: [] };

    for (const node of base.ast.nodes) {
      switch (node.type) {
        case 'char':
          normalizedAst.nodes.push({
            type: 'char',
            value: node.value,
            style: this.cloneDocumentStyle(node.style)
          });
          break;
        case 'stack':
          normalizedAst.nodes.push({
            type: 'stack',
            numerator: node.numerator,
            denominator: node.denominator,
            divider: node.divider,
            style: this.cloneDocumentStyle(node.style)
          });
          break;
        case 'paragraphBreak':
          normalizedAst.nodes.push({
            type: 'paragraphBreak',
            style: this.cloneDocumentStyle(node.style)
          });
          break;
        case 'columnBreak':
        case 'wrapAtDimLine':
          normalizedAst.nodes.push({
            type: 'paragraphBreak',
            style: this.cloneDocumentStyle(node.style)
          });
          break;
        default:
          break;
      }
    }

    return new MTextDocument(normalizedAst);
  }

  private mergeCharFormat(base: CharFormat, patch: Partial<CharFormat>): CharFormat {
    const next: CharFormat = { ...base, ...patch };

    if (patch.aci !== undefined) {
      if (!this.isExplicitAci(patch.aci)) {
        next.aci = null;
      } else {
        const aciColor = this.resolveAciColor(patch.aci);
        next.aci = patch.aci;
        next.rgb = aciColor;
      }
    }

    if (patch.rgb !== undefined) {
      if (patch.rgb === null) {
        next.rgb = null;
      } else {
        next.rgb = this.normalizeColorNumber(patch.rgb);
        if (patch.aci === undefined) next.aci = null;
      }
    }

    return next;
  }

  private cloneDocumentStyle(style: MTextStyle): MTextStyle {
    return {
      underline: style.underline,
      overline: style.overline,
      strikeThrough: style.strikeThrough,
      script: style.script,
      aci: style.aci,
      rgb: style.rgb ? [...style.rgb] as [number, number, number] : null,
      align: style.align,
      fontFace: { ...style.fontFace },
      capHeight: { ...style.capHeight },
      widthFactor: { ...style.widthFactor },
      charTrackingFactor: { ...style.charTrackingFactor },
      oblique: style.oblique,
      paragraph: {
        indent: style.paragraph.indent,
        left: style.paragraph.left,
        right: style.paragraph.right,
        align: style.paragraph.align,
        tabs: [...style.paragraph.tabs]
      }
    };
  }

  private toDocumentStyle(format: CharFormat): MTextStyle {
    const explicitAci = this.isExplicitAci(format.aci) ? format.aci : null;
    const rgbColor = explicitAci !== null
      ? null
      : this.colorNumberToRgbArray(format.rgb !== null ? format.rgb : this.resolveBaseColor());

    const isScript = format.script !== 'normal';
    const capHeight = Math.max(1, format.fontSize * (isScript ? 0.7 : 1));
    const align =
      format.script === 'superscript'
        ? MTextLineAlignment.TOP
        : format.script === 'subscript'
          ? MTextLineAlignment.BOTTOM
          : MTextLineAlignment.MIDDLE;

    return {
      underline: format.underline,
      overline: format.overline,
      strikeThrough: format.strike,
      script: format.script,
      aci: explicitAci,
      rgb: rgbColor,
      align,
      fontFace: {
        family: format.fontFamily,
        style: format.italic ? 'Italic' : 'Regular',
        weight: format.bold ? 700 : 400
      },
      capHeight: { value: capHeight, isRelative: false },
      widthFactor: { value: 1, isRelative: false },
      charTrackingFactor: { value: 1, isRelative: false },
      oblique: 0,
      paragraph: {
        indent: 0,
        left: 0,
        right: 0,
        align: 0,
        tabs: []
      }
    };
  }
  private colorNumberToRgbArray(color: number): [number, number, number] {
    const c = this.normalizeColorNumber(color);
    return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  }

  private rgbArrayToColorNumber(rgb: [number, number, number]): number {
    const r = Math.max(0, Math.min(255, Math.round(rgb[0])));
    const g = Math.max(0, Math.min(255, Math.round(rgb[1])));
    const b = Math.max(0, Math.min(255, Math.round(rgb[2])));
    return (r << 16) | (g << 8) | b;
  }
}

export { MTextInputBox as MTextEditor, defaultCharFormat, sameFormat };
