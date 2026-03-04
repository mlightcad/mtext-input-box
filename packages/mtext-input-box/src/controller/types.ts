import type { MTextStyle } from '../model/types';

export type EditorCommand =
  | { type: 'setCursor'; index: number }
  | { type: 'setSelection'; start: number; end: number }
  | { type: 'clearSelection' }
  | { type: 'moveLeft'; extend?: boolean }
  | { type: 'moveRight'; extend?: boolean }
  | { type: 'moveToStart'; extend?: boolean }
  | { type: 'moveToEnd'; extend?: boolean }
  | { type: 'selectAll' }
  | { type: 'insertText'; text: string; style?: MTextStyle }
  | { type: 'replaceSelection'; text: string; style?: MTextStyle }
  | { type: 'backspace'; count?: number }
  | { type: 'delete'; count?: number };

export interface EditorKeyEventLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}
