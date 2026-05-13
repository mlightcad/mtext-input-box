import { describe, expect, it } from 'vitest';
import {
  MTextContext,
  MTextParagraphAlignment,
  MTextParser,
  TokenType
} from '@mlightcad/mtext-renderer';
import { MTextDocument } from '../src/model/document';
import { contextToStyle } from '../src/model/style';

describe('paragraph alignment in built MTEXT', () => {
  it('includes paragraph codes in toMText and parser yields PROPERTIES_CHANGED', () => {
    const ctx = new MTextContext();
    const base = contextToStyle(ctx);
    const style = {
      ...base,
      paragraph: { ...base.paragraph, align: MTextParagraphAlignment.CENTER }
    };
    const doc = new MTextDocument({
      nodes: [
        { type: 'char', value: 'A', style: { ...style, paragraph: { ...style.paragraph } } },
        { type: 'char', value: 'B', style: { ...style, paragraph: { ...style.paragraph } } }
      ]
    });
    const m = doc.toMText();
    expect(m).toMatch(/\\p[^;]*qc/);

    const p = new MTextParser(m, new MTextContext(), {
      resetParagraphParameters: true,
      yieldPropertyCommands: true
    });
    const types = [...p.parse()].map((t) => t.type);
    expect(types).toContain(TokenType.PROPERTIES_CHANGED);
  });
});
