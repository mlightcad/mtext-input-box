import {
  MTextContext,
  MTextParser,
  type MTextParserOptions,
  TokenType
} from '@mlightcad/mtext-renderer';
import { cloneStyle, contextToStyle, hasNodeStyle, serializeStyleDelta } from './style';
import type { MTextAst, MTextAstNode, MTextStyle } from './types';

/** Parse mtext into a character-level AST suitable for insert/delete/replace workflows. */
export function parseMTextToAst(
  content: string,
  ctx?: MTextContext,
  options: Omit<MTextParserOptions, 'yieldPropertyCommands'> = {}
): MTextAst {
  const parser = new MTextParser(content, ctx, {
    ...options,
    yieldPropertyCommands: false
  });
  const nodes: MTextAstNode[] = [];

  for (const token of parser.parse()) {
    const style = contextToStyle(token.ctx);
    switch (token.type) {
      case TokenType.WORD: {
        const value = token.data as string;
        for (const char of value) {
          nodes.push({ type: 'char', value: char, style: cloneStyle(style) });
        }
        break;
      }
      case TokenType.SPACE:
        nodes.push({ type: 'char', value: ' ', style: cloneStyle(style) });
        break;
      case TokenType.NBSP:
        nodes.push({ type: 'char', value: '\u00a0', style: cloneStyle(style) });
        break;
      case TokenType.TABULATOR:
        nodes.push({ type: 'char', value: '\t', style: cloneStyle(style) });
        break;
      case TokenType.STACK: {
        const [numerator, denominator, divider] = token.data as [string, string, string];
        const stackStyle = cloneStyle(style);
        if (divider === '^') {
          if (numerator.length === 0 && denominator.length > 0) {
            stackStyle.script = 'subscript';
          } else if (numerator.length > 0 && denominator.length === 0) {
            stackStyle.script = 'superscript';
          } else {
            stackStyle.script = 'normal';
          }
        }

        nodes.push({
          type: 'stack',
          numerator,
          denominator,
          divider,
          style: stackStyle
        });
        break;
      }
      case TokenType.NEW_PARAGRAPH:
        nodes.push({ type: 'paragraphBreak', style: cloneStyle(style) });
        break;
      case TokenType.NEW_COLUMN:
        nodes.push({ type: 'columnBreak', style: cloneStyle(style) });
        break;
      case TokenType.WRAP_AT_DIMLINE:
        nodes.push({ type: 'wrapAtDimLine', style: cloneStyle(style) });
        break;
      default:
        break;
    }
  }

  return { nodes };
}

/** Build mtext string from AST. */
export function buildMTextFromAst(ast: MTextAst): string {
  const baseStyle = contextToStyle(new MTextContext());
  let out = '';
  let i = 0;

  while (i < ast.nodes.length) {
    const node = ast.nodes[i];
    if (!node) break;

    if (!hasNodeStyle(node)) {
      out += serializeNode(node);
      i += 1;
      continue;
    }

    const runStyle = node.style;
    let runContent = '';
    let j = i;

    while (j < ast.nodes.length) {
      const current = ast.nodes[j];
      if (!current || !hasNodeStyle(current) || !stylesEqual(runStyle, current.style)) {
        break;
      }
      runContent += serializeNode(current);
      j += 1;
    }

    if (stylesEqual(runStyle, baseStyle)) {
      out += runContent;
    } else {
      out += `{${serializeStyleDelta(null, runStyle)}${runContent}}`;
    }

    i = j;
  }

  return out;
}

/** Insert plain text at a character position. */
export function insertTextInAst(ast: MTextAst, index: number, text: string, style?: MTextStyle): MTextAst {
  const safeIndex = clamp(index, 0, ast.nodes.length);
  const insertStyle = style ?? inferInsertStyle(ast, safeIndex) ?? contextToStyle(new MTextContext());
  const newNodes = textToAstNodes(text, insertStyle);

  ast.nodes.splice(safeIndex, 0, ...newNodes);
  return ast;
}

/** Delete nodes in [start, start + count). */
export function deleteRangeInAst(ast: MTextAst, start: number, count: number): MTextAst {
  if (count <= 0) return ast;
  const safeStart = clamp(start, 0, ast.nodes.length);
  const safeCount = clamp(count, 0, ast.nodes.length - safeStart);
  ast.nodes.splice(safeStart, safeCount);
  return ast;
}

/** Replace nodes in [start, start + count) with plain text. */
export function replaceRangeInAst(
  ast: MTextAst,
  start: number,
  count: number,
  text: string,
  style?: MTextStyle
): MTextAst {
  const safeStart = clamp(start, 0, ast.nodes.length);
  const safeCount = clamp(count, 0, ast.nodes.length - safeStart);
  const insertStyle = style ?? inferInsertStyle(ast, safeStart) ?? contextToStyle(new MTextContext());
  const newNodes = textToAstNodes(text, insertStyle);

  ast.nodes.splice(safeStart, safeCount, ...newNodes);
  return ast;
}

export function inferInsertStyle(ast: MTextAst, index: number): MTextStyle | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const node = ast.nodes[i];
    if (node && hasNodeStyle(node)) {
      return cloneStyle(node.style);
    }
  }
  for (let i = index; i < ast.nodes.length; i++) {
    const node = ast.nodes[i];
    if (node && hasNodeStyle(node)) {
      return cloneStyle(node.style);
    }
  }
  return undefined;
}

function encodeChar(char: string): string {
  if (char === '\u00a0') return '\\~';
  if (char === '\t') return '^I';
  if (char === '\\') return '\\\\';
  if (char === '{') return '\\{';
  if (char === '}') return '\\}';
  if (char === '^') return '\\U+005E';
  if (char === '%') return '\\U+0025';
  if (char === '\n') return '\\P';
  if (char === '\r') return '';
  return char;
}

function escapeStackPart(value: string): string {
  return value.replace(/[\\;/#^]/g, '\\$&');
}

function stylesEqual(a: MTextStyle, b: MTextStyle): boolean {
  return serializeStyleDelta(a, b) === '';
}

function serializeNode(node: MTextAstNode): string {
  switch (node.type) {
    case 'char':
      return encodeChar(node.value);
    case 'stack':
      return serializeStackNode(node.numerator, node.denominator, node.divider);
    case 'paragraphBreak':
      return '\\P';
    case 'columnBreak':
      return '\\N';
    case 'wrapAtDimLine':
      return '\\X';
  }
}

function serializeStackNode(numerator: string, denominator: string, divider: string): string {
  const top = escapeStackPart(numerator);
  const bottom = escapeStackPart(denominator);

  // mtext-parser expects explicit space for ^-based super/subscript when one side is empty.
  if (divider === '^') {
    if (top.length === 0 && bottom.length > 0) {
      return `\\S^ ${bottom};`;
    }
    if (top.length > 0 && bottom.length === 0) {
      return `\\S${top}^ ;`;
    }
    if (top.length === 0 && bottom.length === 0) {
      return '\\S^ ;';
    }
  }

  return `\\S${top}${divider}${bottom};`;
}

function textToAstNodes(text: string, style: MTextStyle): MTextAstNode[] {
  const nodes: MTextAstNode[] = [];
  for (const ch of text) {
    if (ch === '\n') {
      nodes.push({ type: 'paragraphBreak', style: cloneStyle(style) });
      continue;
    }
    nodes.push({ type: 'char', value: ch, style: cloneStyle(style) });
  }
  return nodes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
