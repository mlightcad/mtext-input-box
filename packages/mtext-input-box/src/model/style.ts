import {
  MTextContext,
  MTextLineAlignment,
  MTextParagraphAlignment,
  rgb2int,
  type FactorValue,
  type RGB,
  type ParagraphProperties
} from '@mlightcad/mtext-parser';
import type {
  MTextAstCharNode,
  MTextAstColumnBreakNode,
  MTextAstNode,
  MTextAstParagraphBreakNode,
  MTextAstStackNode,
  MTextAstWrapAtDimLineNode,
  MTextScript,
  MTextStyle
} from './types';

function scriptFromAlign(align: MTextLineAlignment): MTextScript {
  if (align === MTextLineAlignment.TOP) return 'superscript';
  if (align === MTextLineAlignment.BOTTOM) return 'subscript';
  return 'normal';
}

function alignFromScript(script: MTextScript): MTextLineAlignment {
  if (script === 'superscript') return MTextLineAlignment.TOP;
  if (script === 'subscript') return MTextLineAlignment.BOTTOM;
  return MTextLineAlignment.MIDDLE;
}

function applyScriptToStyle(style: MTextStyle): MTextStyle {
  return {
    ...style,
    align: alignFromScript(style.script)
  };
}

export function contextToStyle(ctx: MTextContext): MTextStyle {
  return {
    underline: ctx.underline,
    overline: ctx.overline,
    strikeThrough: ctx.strikeThrough,
    script: scriptFromAlign(ctx.align),
    aci: ctx.aci,
    rgb: ctx.rgb ? ([...ctx.rgb] as RGB) : null,
    align: ctx.align,
    fontFace: { ...ctx.fontFace },
    capHeight: { ...ctx.capHeight },
    widthFactor: { ...ctx.widthFactor },
    charTrackingFactor: { ...ctx.charTrackingFactor },
    oblique: ctx.oblique,
    paragraph: {
      indent: ctx.paragraph.indent,
      left: ctx.paragraph.left,
      right: ctx.paragraph.right,
      align: ctx.paragraph.align,
      tabs: [...ctx.paragraph.tabs]
    }
  };
}

export function cloneStyle(style: MTextStyle): MTextStyle {
  return {
    underline: style.underline,
    overline: style.overline,
    strikeThrough: style.strikeThrough,
    script: style.script,
    aci: style.aci,
    rgb: style.rgb ? ([...style.rgb] as RGB) : null,
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

export function hasNodeStyle(node: MTextAstNode): node is (
  | MTextAstCharNode
  | MTextAstStackNode
  | MTextAstParagraphBreakNode
  | MTextAstColumnBreakNode
  | MTextAstWrapAtDimLineNode
) {
  return (
    node.type === 'char' ||
    node.type === 'stack' ||
    node.type === 'paragraphBreak' ||
    node.type === 'columnBreak' ||
    node.type === 'wrapAtDimLine'
  );
}

function stylesEqual(a: MTextStyle, b: MTextStyle): boolean {
  return (
    a.underline === b.underline &&
    a.overline === b.overline &&
    a.strikeThrough === b.strikeThrough &&
    a.script === b.script &&
    a.aci === b.aci &&
    JSON.stringify(a.rgb) === JSON.stringify(b.rgb) &&
    a.align === b.align &&
    a.fontFace.family === b.fontFace.family &&
    a.fontFace.style === b.fontFace.style &&
    a.fontFace.weight === b.fontFace.weight &&
    a.capHeight.value === b.capHeight.value &&
    a.capHeight.isRelative === b.capHeight.isRelative &&
    a.widthFactor.value === b.widthFactor.value &&
    a.widthFactor.isRelative === b.widthFactor.isRelative &&
    a.charTrackingFactor.value === b.charTrackingFactor.value &&
    a.charTrackingFactor.isRelative === b.charTrackingFactor.isRelative &&
    a.oblique === b.oblique &&
    a.paragraph.indent === b.paragraph.indent &&
    a.paragraph.left === b.paragraph.left &&
    a.paragraph.right === b.paragraph.right &&
    a.paragraph.align === b.paragraph.align &&
    JSON.stringify(a.paragraph.tabs) === JSON.stringify(b.paragraph.tabs)
  );
}

export function serializeStyleDelta(prev: MTextStyle | null, next: MTextStyle): string {
  const fromRaw = prev ?? contextToStyle(new MTextContext());
  const from = applyScriptToStyle(fromRaw);
  const nextWithScript = applyScriptToStyle(next);

  if (stylesEqual(from, nextWithScript)) {
    return '';
  }

  let out = '';

  if (from.underline !== nextWithScript.underline) out += nextWithScript.underline ? '\\L' : '\\l';
  if (from.overline !== nextWithScript.overline) out += nextWithScript.overline ? '\\O' : '\\o';
  if (from.strikeThrough !== nextWithScript.strikeThrough) out += nextWithScript.strikeThrough ? '\\K' : '\\k';

  if (from.align !== nextWithScript.align) {
    out += `\\A${nextWithScript.align};`;
  }

  if (from.aci !== nextWithScript.aci || JSON.stringify(from.rgb) !== JSON.stringify(nextWithScript.rgb)) {
    if (nextWithScript.rgb) {
      out += `\\c${rgb2int(nextWithScript.rgb)};`;
    } else {
      out += `\\C${nextWithScript.aci ?? 256};`;
    }
  }

  if (
    from.fontFace.family !== nextWithScript.fontFace.family ||
    from.fontFace.style !== nextWithScript.fontFace.style ||
    from.fontFace.weight !== nextWithScript.fontFace.weight
  ) {
    const bold = nextWithScript.fontFace.weight >= 700 ? 1 : 0;
    const italic = nextWithScript.fontFace.style === 'Italic' ? 1 : 0;
    out += `\\f${nextWithScript.fontFace.family}|b${bold}|i${italic};`;
  }

  if (
    from.capHeight.value !== nextWithScript.capHeight.value ||
    from.capHeight.isRelative !== nextWithScript.capHeight.isRelative
  ) {
    out += `\\H${formatFactor(nextWithScript.capHeight)};`;
  }

  if (
    from.widthFactor.value !== nextWithScript.widthFactor.value ||
    from.widthFactor.isRelative !== nextWithScript.widthFactor.isRelative
  ) {
    out += `\\W${formatFactor(nextWithScript.widthFactor)};`;
  }

  if (
    from.charTrackingFactor.value !== nextWithScript.charTrackingFactor.value ||
    from.charTrackingFactor.isRelative !== nextWithScript.charTrackingFactor.isRelative
  ) {
    out += `\\T${formatFactor(nextWithScript.charTrackingFactor)};`;
  }

  if (from.oblique !== nextWithScript.oblique) {
    out += `\\Q${formatNumber(nextWithScript.oblique)};`;
  }

  if (JSON.stringify(from.paragraph) !== JSON.stringify(nextWithScript.paragraph)) {
    out += `\\p${serializeParagraph(nextWithScript.paragraph)};`;
  }

  return out;
}

function formatFactor(value: FactorValue): string {
  return `${formatNumber(value.value)}${value.isRelative ? 'x' : ''}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toString();
}

function serializeParagraph(paragraph: ParagraphProperties): string {
  const parts = [
    `i${formatNumber(paragraph.indent)}`,
    `l${formatNumber(paragraph.left)}`,
    `r${formatNumber(paragraph.right)}`
  ];

  if (paragraph.align !== MTextParagraphAlignment.DEFAULT) {
    parts.push(`q${paragraphAlignToChar(paragraph.align)}`);
  }

  if (paragraph.tabs.length > 0) {
    parts.push(`t${paragraph.tabs.map((tab) => String(tab)).join(',')}`);
  }

  return parts.join(',');
}

function paragraphAlignToChar(align: MTextParagraphAlignment): string {
  switch (align) {
    case MTextParagraphAlignment.LEFT:
      return 'l';
    case MTextParagraphAlignment.RIGHT:
      return 'r';
    case MTextParagraphAlignment.CENTER:
      return 'c';
    case MTextParagraphAlignment.JUSTIFIED:
      return 'j';
    case MTextParagraphAlignment.DISTRIBUTED:
      return 'd';
    default:
      return 'x';
  }
}
