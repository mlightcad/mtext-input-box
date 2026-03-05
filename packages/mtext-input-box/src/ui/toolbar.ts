import type { CharFormat, MTextToolbarTheme } from '../viewer/types';
import { toolbarIcons, type ToolbarIconName } from './icons';

export interface ToolbarOptions {
  anchorElement: HTMLElement;
  container?: HTMLElement;
  theme: MTextToolbarTheme;
  fontFamilies?: string[];
  onFormatChange: (partial: Partial<CharFormat>) => void;
  onToggleStack: () => void;
  onToggleSuperscript?: () => boolean;
  onToggleSubscript?: () => boolean;
}

export type ToolbarSessionOptions = Omit<ToolbarOptions, 'container' | 'theme' | 'fontFamilies'>;

interface ToolbarControls {
  fontFamily: HTMLSelectElement;
  fontSize: HTMLInputElement;
  fontColor: HTMLInputElement;
  boldBtn: HTMLButtonElement;
  italicBtn: HTMLButtonElement;
  underlineBtn: HTMLButtonElement;
  overlineBtn: HTMLButtonElement;
  strikeBtn: HTMLButtonElement;
  superscriptBtn: HTMLButtonElement;
  subscriptBtn: HTMLButtonElement;
  stackBtn: HTMLButtonElement;
}

const STYLE_ID = 'mlightcad-mtext-toolbar-style';
const DEFAULT_FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace'
];

function ensureToolbarStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.ml-mtext-toolbar {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  border: 1px solid;
  padding: 8px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  user-select: none;
}
.ml-mtext-toolbar[data-theme='dark'] {
  background: linear-gradient(180deg, #2a2d33 0%, #1d2025 100%);
  border-color: #444b58;
  color: #e8ecf4;
}
.ml-mtext-toolbar[data-theme='light'] {
  background: linear-gradient(180deg, #ffffff 0%, #f2f4f8 100%);
  border-color: #cfd5df;
  color: #1e2430;
}
.ml-mtext-toolbar__group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ml-mtext-toolbar__separator {
  width: 1px;
  height: 24px;
  opacity: 0.35;
}
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__separator {
  background: #576177;
}
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__separator {
  background: #b8c0ce;
}
.ml-mtext-toolbar__select,
.ml-mtext-toolbar__input,
.ml-mtext-toolbar__color,
.ml-mtext-toolbar__btn {
  border: 1px solid;
  border-radius: 6px;
  height: 34px;
}
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__select,
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__input,
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__color,
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__btn {
  background: #12161d;
  border-color: #454d5f;
  color: #f2f5fb;
}
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__select,
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__input,
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__color,
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__btn {
  background: #ffffff;
  border-color: #c7cdd8;
  color: #1f2632;
}
.ml-mtext-toolbar__select {
  min-width: 140px;
  padding: 0 8px;
}
.ml-mtext-toolbar__input {
  width: 64px;
  padding: 0 8px;
}
.ml-mtext-toolbar__color {
  width: 40px;
  padding: 2px;
}
.ml-mtext-toolbar__btn {
  width: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
}
.ml-mtext-toolbar__btn svg {
  width: 24px;
  height: 24px;
  fill: currentColor;
}
.ml-mtext-toolbar__btn.is-active {
  border-color: #2f9dff;
  color: #2f9dff;
}
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__btn.is-active {
  background: linear-gradient(180deg, #123252 0%, #0c243d 100%);
  color: #8fcbff;
  box-shadow: inset 0 0 0 1px rgba(143, 203, 255, 0.18);
}
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__btn.is-active {
  background: linear-gradient(180deg, #dcebff 0%, #cfe3ff 100%);
  color: #1d67ad;
  box-shadow: inset 0 0 0 1px rgba(29, 103, 173, 0.16);
}
.ml-mtext-toolbar[data-theme='dark'] .ml-mtext-toolbar__btn:hover {
  background: #1f2530;
}
.ml-mtext-toolbar[data-theme='light'] .ml-mtext-toolbar__btn:hover {
  background: #edf3ff;
}
`;

  document.head.appendChild(style);
}

function normalizeColorNumber(color: number): number {
  return Math.max(0, Math.min(0xffffff, Math.round(color)));
}

function colorNumberToHex(color: number | null): string {
  const resolved = color === null ? 0xffffff : normalizeColorNumber(color);
  return `#${resolved.toString(16).padStart(6, '0')}`;
}

function hexToColorNumber(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 0xffffff;
  return Number.parseInt(hex.slice(1), 16);
}

function createIconButton(title: string, icon: ToolbarIconName): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ml-mtext-toolbar__btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = toolbarIcons[icon];
  return btn;
}

function resolveFontFamilies(fontFamilies?: string[]): string[] {
  const source = fontFamilies && fontFamilies.length > 0 ? fontFamilies : DEFAULT_FONT_FAMILIES;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  return unique.length > 0 ? unique : [...DEFAULT_FONT_FAMILIES];
}

export class MTextToolbar {
  private anchorElement: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly controls: ToolbarControls;
  private onFormatChange: (partial: Partial<CharFormat>) => void;
  private onToggleStack: () => void;
  private onToggleSuperscript: () => boolean;
  private onToggleSubscript: () => boolean;
  private theme: MTextToolbarTheme;

  constructor(options: ToolbarOptions) {
    ensureToolbarStyles();

    this.anchorElement = options.anchorElement;
    this.onFormatChange = options.onFormatChange;
    this.onToggleStack = options.onToggleStack ?? (() => {});
    this.onToggleSuperscript = options.onToggleSuperscript ?? (() => false);
    this.onToggleSubscript = options.onToggleSubscript ?? (() => false);
    this.theme = options.theme;

    this.root = document.createElement('div');
    this.root.className = 'ml-mtext-toolbar';

    const typographyGroup = document.createElement('div');
    typographyGroup.className = 'ml-mtext-toolbar__group';

    const fontFamily = document.createElement('select');
    fontFamily.className = 'ml-mtext-toolbar__select';
    for (const family of resolveFontFamilies(options.fontFamilies)) {
      const option = document.createElement('option');
      option.value = family;
      option.textContent = family;
      fontFamily.appendChild(option);
    }

    const fontSize = document.createElement('input');
    fontSize.className = 'ml-mtext-toolbar__input';
    fontSize.type = 'number';
    fontSize.min = '1';
    fontSize.max = '1024';
    fontSize.step = '1';

    const fontColor = document.createElement('input');
    fontColor.className = 'ml-mtext-toolbar__color';
    fontColor.type = 'color';

    typographyGroup.append(fontFamily, fontSize, fontColor);

    const separator1 = document.createElement('div');
    separator1.className = 'ml-mtext-toolbar__separator';

    const styleGroup = document.createElement('div');
    styleGroup.className = 'ml-mtext-toolbar__group';
    const boldBtn = createIconButton('Bold', 'bold');
    const italicBtn = createIconButton('Italic', 'italic');
    const underlineBtn = createIconButton('Underline', 'underline');
    const overlineBtn = createIconButton('Overline', 'overline');
    const strikeBtn = createIconButton('Strike Through', 'strike');
    const superscriptBtn = createIconButton('Superscript', 'superscript');
    const subscriptBtn = createIconButton('Subscript', 'subscript');
    const stackBtn = createIconButton('Stack', 'stack');
    styleGroup.append(
      boldBtn,
      italicBtn,
      underlineBtn,
      overlineBtn,
      strikeBtn,
      superscriptBtn,
      subscriptBtn,
      stackBtn
    );

    this.root.append(typographyGroup, separator1, styleGroup);

    this.controls = {
      fontFamily,
      fontSize,
      fontColor,
      boldBtn,
      italicBtn,
      underlineBtn,
      overlineBtn,
      strikeBtn,
      superscriptBtn,
      subscriptBtn,
      stackBtn
    };

    this.setTheme(this.theme);
    this.bindEvents();

    (options.container ?? document.body).appendChild(this.root);
  }

  public setTheme(theme: MTextToolbarTheme): void {
    this.theme = theme;
    this.root.dataset.theme = theme;
  }

  public getTheme(): MTextToolbarTheme {
    return this.theme;
  }

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'inline-flex' : 'none';
  }

  public setSession(options: ToolbarSessionOptions): void {
    this.anchorElement = options.anchorElement;
    this.onFormatChange = options.onFormatChange;
    this.onToggleStack = options.onToggleStack;
    this.onToggleSuperscript = options.onToggleSuperscript ?? (() => false);
    this.onToggleSubscript = options.onToggleSubscript ?? (() => false);
  }

  public setAnchor(clientX: number, clientY: number): void {
    const width = this.root.offsetWidth || 0;
    const height = this.root.offsetHeight || 0;

    const minX = 8;
    const minY = 8;
    const maxX = Math.max(minX, window.innerWidth - width - 8);
    const maxY = Math.max(minY, window.innerHeight - height - 8);

    const x = Math.max(minX, Math.min(maxX, Math.round(clientX)));
    const y = Math.max(minY, Math.min(maxY, Math.round(clientY - height)));

    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }

  public setFormat(format: CharFormat): void {
    this.ensureSelectValue(format.fontFamily);
    this.controls.fontSize.value = String(Math.max(1, Math.round(format.fontSize)));

    const color = format.rgb !== null ? format.rgb : 0xffffff;
    this.controls.fontColor.value = colorNumberToHex(color);

    this.setToggleState(this.controls.boldBtn, format.bold);
    this.setToggleState(this.controls.italicBtn, format.italic);
    this.setToggleState(this.controls.underlineBtn, format.underline);
    this.setToggleState(this.controls.overlineBtn, format.overline);
    this.setToggleState(this.controls.strikeBtn, format.strike);
    this.setToggleState(this.controls.superscriptBtn, format.script === 'superscript');
    this.setToggleState(this.controls.subscriptBtn, format.script === 'subscript');
  }

  public dispose(): void {
    this.root.remove();
  }

  public setStackActive(active: boolean): void {
    this.setToggleState(this.controls.stackBtn, active);
  }

  private setToggleState(button: HTMLButtonElement, active: boolean): void {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  private ensureSelectValue(fontFamily: string): void {
    const existing = Array.from(this.controls.fontFamily.options).some((item) => item.value === fontFamily);
    if (!existing) {
      const option = document.createElement('option');
      option.value = fontFamily;
      option.textContent = fontFamily;
      this.controls.fontFamily.appendChild(option);
    }
    this.controls.fontFamily.value = fontFamily;
  }

  private bindEvents(): void {
    const applyFontSize = (): void => {
      const value = Math.max(1, Number(this.controls.fontSize.value) || 1);
      this.controls.fontSize.value = String(Math.round(value));
      this.onFormatChange({ fontSize: value });
    };

    this.controls.fontFamily.addEventListener('change', () => {
      this.onFormatChange({ fontFamily: this.controls.fontFamily.value });
    });

    this.controls.fontSize.addEventListener('input', applyFontSize);
    this.controls.fontSize.addEventListener('change', applyFontSize);
    this.controls.fontSize.addEventListener('blur', applyFontSize);
    this.controls.fontSize.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        applyFontSize();
        this.anchorElement.focus({ preventScroll: true });
      }
    });

    this.controls.fontColor.addEventListener('input', () => {
      this.onFormatChange({
        aci: null,
        rgb: hexToColorNumber(this.controls.fontColor.value)
      });
    });

    this.controls.boldBtn.addEventListener('click', () => {
      this.onFormatChange({ bold: !this.controls.boldBtn.classList.contains('is-active') });
    });
    this.controls.italicBtn.addEventListener('click', () => {
      this.onFormatChange({ italic: !this.controls.italicBtn.classList.contains('is-active') });
    });
    this.controls.underlineBtn.addEventListener('click', () => {
      this.onFormatChange({ underline: !this.controls.underlineBtn.classList.contains('is-active') });
    });
    this.controls.overlineBtn.addEventListener('click', () => {
      this.onFormatChange({ overline: !this.controls.overlineBtn.classList.contains('is-active') });
    });
    this.controls.strikeBtn.addEventListener('click', () => {
      this.onFormatChange({ strike: !this.controls.strikeBtn.classList.contains('is-active') });
    });
    this.controls.superscriptBtn.addEventListener('click', () => {
      if (this.onToggleSuperscript()) return;
      const active = this.controls.superscriptBtn.classList.contains('is-active');
      this.onFormatChange({ script: active ? 'normal' : 'superscript' });
    });
    this.controls.subscriptBtn.addEventListener('click', () => {
      if (this.onToggleSubscript()) return;
      const active = this.controls.subscriptBtn.classList.contains('is-active');
      this.onFormatChange({ script: active ? 'normal' : 'subscript' });
    });
    this.controls.stackBtn.addEventListener('click', () => {
      this.onToggleStack();
    });

    this.root.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'OPTION') return;
      event.preventDefault();
      this.anchorElement.focus({ preventScroll: true });
    });
  }
}

