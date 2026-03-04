import { MTextContext } from '@mlightcad/mtext-parser';
import {
  buildMTextFromAst,
  deleteRangeInAst,
  inferInsertStyle,
  parseMTextToAst,
  replaceRangeInAst
} from './ast';
import { cloneStyle, contextToStyle } from './style';
import type { EditorSelection, MTextAst, MTextAstNode, MTextStyle } from './types';

/** Minimal mtext editor document wrapper on top of AST. */
export class MTextDocument {
  private _ast: MTextAst;
  private _cursor: number;
  private _selection: EditorSelection | null = null;

  constructor(astOrMText: MTextAst | string = { nodes: [] }) {
    this._ast =
      typeof astOrMText === 'string' ? parseMTextToAst(astOrMText) : MTextDocument.cloneAst(astOrMText);
    this._cursor = this._ast.nodes.length;
  }

  static fromMText(mtext: string, ctx?: MTextContext): MTextDocument {
    return new MTextDocument(parseMTextToAst(mtext, ctx));
  }

  get ast(): MTextAst {
    return this._ast;
  }

  get length(): number {
    return this._ast.nodes.length;
  }

  get cursor(): number {
    return this._cursor;
  }

  set cursor(value: number) {
    this._cursor = MTextDocument.clamp(value, 0, this.length);
    this._selection = null;
  }

  get selection(): EditorSelection | null {
    return this._selection ? { ...this._selection } : null;
  }

  setSelection(start: number, end: number): this {
    const normalized = MTextDocument.normalizeSelection(start, end, this.length);
    this._selection = normalized.start === normalized.end ? null : normalized;
    this._cursor = MTextDocument.clamp(end, 0, this.length);
    return this;
  }

  clearSelection(): this {
    this._selection = null;
    return this;
  }

  moveCursor(delta: number, extendSelection: boolean = false): this {
    const next = MTextDocument.clamp(this._cursor + delta, 0, this.length);
    if (extendSelection) {
      const anchor = this._selection ? this._selection.start : this._cursor;
      this.setSelection(anchor, next);
    } else {
      this.cursor = next;
    }
    return this;
  }

  selectAll(): this {
    this.setSelection(0, this.length);
    return this;
  }

  insertText(text: string, style?: MTextStyle): this {
    const { start, end } = this.getActiveRange();
    replaceRangeInAst(this._ast, start, end - start, text, style);
    this._cursor = start + text.length;
    this._selection = null;
    return this;
  }

  deleteBackward(count: number = 1): this {
    if (this.hasSelection()) {
      const { start, end } = this.getActiveRange();
      deleteRangeInAst(this._ast, start, end - start);
      this._cursor = start;
      this._selection = null;
      return this;
    }
    if (count <= 0 || this._cursor <= 0) return this;
    const remove = Math.min(count, this._cursor);
    deleteRangeInAst(this._ast, this._cursor - remove, remove);
    this._cursor -= remove;
    return this;
  }

  deleteForward(count: number = 1): this {
    if (this.hasSelection()) {
      const { start, end } = this.getActiveRange();
      deleteRangeInAst(this._ast, start, end - start);
      this._cursor = start;
      this._selection = null;
      return this;
    }
    if (count <= 0 || this._cursor >= this.length) return this;
    deleteRangeInAst(this._ast, this._cursor, count);
    return this;
  }

  replaceSelection(text: string, style?: MTextStyle): this {
    return this.insertText(text, style);
  }

  toMText(): string {
    return buildMTextFromAst(this._ast);
  }

  transaction(work: (doc: MTextDocument) => void): this {
    const snapshot = {
      ast: MTextDocument.cloneAst(this._ast),
      cursor: this._cursor,
      selection: this._selection ? { ...this._selection } : null
    };

    try {
      work(this);
    } catch (error) {
      this._ast = snapshot.ast;
      this._cursor = snapshot.cursor;
      this._selection = snapshot.selection;
      throw error;
    }

    return this;
  }

  private hasSelection(): boolean {
    return Boolean(this._selection && this._selection.start !== this._selection.end);
  }

  private getActiveRange(): EditorSelection {
    if (this._selection) return { ...this._selection };
    return { start: this._cursor, end: this._cursor };
  }

  private getReferenceStyle(index: number): MTextStyle {
    return inferInsertStyle(this._ast, index) ?? contextToStyle(new MTextContext());
  }

  private static cloneAst(ast: MTextAst): MTextAst {
    return {
      nodes: ast.nodes.map((node: MTextAstNode) => {
        if (node.type === 'char') return { ...node, style: cloneStyle(node.style) };
        if (node.type === 'stack') return { ...node, style: cloneStyle(node.style) };
        return { ...node, style: cloneStyle(node.style) };
      })
    };
  }

  private static normalizeSelection(start: number, end: number, max: number): EditorSelection {
    const a = MTextDocument.clamp(start, 0, max);
    const b = MTextDocument.clamp(end, 0, max);
    return a <= b ? { start: a, end: b } : { start: b, end: a };
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
