import { MTextDocument } from '../model/document';
import type { EditorCommand, EditorKeyEventLike } from './types';

/** Thin adapter for UI keyboard/command integration with selection anchor semantics. */
export class EditorUiAdapter {
  private selectionAnchor: number | null = null;

  constructor(public readonly document: MTextDocument) {}

  get anchor(): number | null {
    return this.selectionAnchor;
  }

  execute(command: EditorCommand): this {
    switch (command.type) {
      case 'setCursor':
        this.document.cursor = command.index;
        this.selectionAnchor = null;
        break;
      case 'setSelection':
        this.document.setSelection(command.start, command.end);
        this.selectionAnchor = command.start;
        break;
      case 'clearSelection':
        this.document.clearSelection();
        this.selectionAnchor = null;
        break;
      case 'moveLeft':
        this.moveCursorTo(this.document.cursor - 1, command.extend ?? false);
        break;
      case 'moveRight':
        this.moveCursorTo(this.document.cursor + 1, command.extend ?? false);
        break;
      case 'moveToStart':
        this.moveCursorTo(0, command.extend ?? false);
        break;
      case 'moveToEnd':
        this.moveCursorTo(this.document.length, command.extend ?? false);
        break;
      case 'selectAll':
        this.document.selectAll();
        this.selectionAnchor = 0;
        break;
      case 'insertText':
        this.document.insertText(command.text, command.style);
        this.selectionAnchor = null;
        break;
      case 'replaceSelection':
        this.document.replaceSelection(command.text, command.style);
        this.selectionAnchor = null;
        break;
      case 'backspace':
        this.document.deleteBackward(command.count ?? 1);
        this.selectionAnchor = null;
        break;
      case 'delete':
        this.document.deleteForward(command.count ?? 1);
        this.selectionAnchor = null;
        break;
      default:
        break;
    }
    return this;
  }

  /** Maps keyboard-like events into editor commands. Returns true if handled. */
  handleKeyEvent(event: EditorKeyEventLike): boolean {
    const metaOrCtrl = Boolean(event.metaKey || event.ctrlKey);

    if (metaOrCtrl && !event.altKey && event.key.toLowerCase() === 'a') {
      this.execute({ type: 'selectAll' });
      return true;
    }

    if (event.key === 'ArrowLeft') {
      this.execute({ type: 'moveLeft', extend: Boolean(event.shiftKey) });
      return true;
    }
    if (event.key === 'ArrowRight') {
      this.execute({ type: 'moveRight', extend: Boolean(event.shiftKey) });
      return true;
    }
    if (event.key === 'Home') {
      this.execute({ type: 'moveToStart', extend: Boolean(event.shiftKey) });
      return true;
    }
    if (event.key === 'End') {
      this.execute({ type: 'moveToEnd', extend: Boolean(event.shiftKey) });
      return true;
    }
    if (event.key === 'Backspace') {
      this.execute({ type: 'backspace' });
      return true;
    }
    if (event.key === 'Delete') {
      this.execute({ type: 'delete' });
      return true;
    }
    if (event.key === 'Enter') {
      this.execute({ type: 'insertText', text: '\n' });
      return true;
    }
    if (event.key === 'Tab') {
      this.execute({ type: 'insertText', text: '\t' });
      return true;
    }

    if (!metaOrCtrl && !event.altKey && event.key.length === 1) {
      this.execute({ type: 'insertText', text: event.key });
      return true;
    }

    return false;
  }

  private moveCursorTo(target: number, extend: boolean): void {
    const clamped = Math.max(0, Math.min(target, this.document.length));
    if (extend) {
      if (this.selectionAnchor === null) {
        this.selectionAnchor = this.document.selection?.start ?? this.document.cursor;
      }
      this.document.setSelection(this.selectionAnchor, clamped);
      return;
    }

    this.document.cursor = clamped;
    this.selectionAnchor = null;
  }
}
