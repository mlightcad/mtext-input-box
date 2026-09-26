import type {
  FactorValue,
  FontFace,
  MTextLineAlignment,
  ParagraphProperties,
  RGB
} from '@mlightcad/mtext-parser';

export type MTextScript = 'normal' | 'superscript' | 'subscript';

/** Snapshot of resolved text style for editable AST nodes. */
export interface MTextStyle {
  underline: boolean;
  overline: boolean;
  strikeThrough: boolean;
  script: MTextScript;
  aci: number | null;
  rgb: RGB | null;
  align: MTextLineAlignment;
  fontFace: FontFace;
  capHeight: FactorValue;
  widthFactor: FactorValue;
  charTrackingFactor: FactorValue;
  oblique: number;
  paragraph: ParagraphProperties;
}

/** Character node for rich text editing. */
export interface MTextAstCharNode {
  type: 'char';
  value: string;
  style: MTextStyle;
}

/** Fraction/stacking node (e.g. \S1/2;). */
export interface MTextAstStackNode {
  type: 'stack';
  numerator: string;
  denominator: string;
  divider: string;
  style: MTextStyle;
}

/** Paragraph break node (maps to \P). */
export interface MTextAstParagraphBreakNode {
  type: 'paragraphBreak';
  style: MTextStyle;
}

/** Column break node (maps to \N). */
export interface MTextAstColumnBreakNode {
  type: 'columnBreak';
  style: MTextStyle;
}

/** Wrap-at-dimension-line node (maps to \X). */
export interface MTextAstWrapAtDimLineNode {
  type: 'wrapAtDimLine';
  style: MTextStyle;
}

export type MTextAstNode =
  | MTextAstCharNode
  | MTextAstStackNode
  | MTextAstParagraphBreakNode
  | MTextAstColumnBreakNode
  | MTextAstWrapAtDimLineNode;

/** Character-level editable AST model. */
export interface MTextAst {
  nodes: MTextAstNode[];
}

/** Selection range in AST node indexes. */
export interface EditorSelection {
  start: number;
  end: number;
}
