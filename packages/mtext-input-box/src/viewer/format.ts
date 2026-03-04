import type { CharFormat } from './types';

/** Returns default character format. */
export function defaultCharFormat(): CharFormat {
  return {
    fontFamily: 'monospace',
    fontSize: 24,
    bold: false,
    italic: false,
    underline: false,
    overline: false,
    strike: false,
    script: 'normal',
    aci: null,
    rgb: 0xffffff
  };
}

/** Compares two formats. */
export function sameFormat(a: CharFormat, b: CharFormat): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.overline === b.overline &&
    a.strike === b.strike &&
    a.script === b.script &&
    a.aci === b.aci &&
    a.rgb === b.rgb
  );
}
