import { describe, expect, test } from 'vitest';
import { CursorRenderer } from '../src/CursorRenderer';
import type {
  BoxOptions,
  I3DRenderer,
  LineOptions,
  QuadOptions,
  TextOptions,
  Transform
} from '../src/renderer/types';

class MockRenderer implements I3DRenderer {
  beginFrameCount = 0;
  endFrameCount = 0;
  destroyed = false;
  quads: QuadOptions[] = [];
  lines: LineOptions[] = [];
  texts: TextOptions[] = [];

  initialize(canvas: HTMLCanvasElement): void {
    void canvas;
  }
  destroy(): void {
    this.destroyed = true;
  }
  beginFrame(): void {
    this.beginFrameCount += 1;
  }
  endFrame(): void {
    this.endFrameCount += 1;
  }
  drawQuad(options: QuadOptions): void {
    this.quads.push(options);
  }
  drawLine(options: LineOptions): void {
    this.lines.push(options);
  }
  drawText(options: TextOptions): void {
    this.texts.push(options);
  }
  drawBox(options: BoxOptions): void {
    this.quads.push({
      x: options.box.x,
      y: options.box.y,
      width: options.box.width,
      height: options.box.height,
      borderColor: options.color
    });
  }
  setTransform(transform: Transform): void {
    void transform;
  }
  resetTransform(): void {}
}

describe('CursorRenderer', () => {
  test('renders cursor and selection from external state', () => {
    const mock = new MockRenderer();
    const renderer = new CursorRenderer({
      renderer: mock,
      enableSelection: true,
      enableDebug: false,
      cursorStyle: { blinkEnabled: false }
    });

    renderer.updateCursor({ x: 20, y: 30 }, 24);
    renderer.updateSelection([{ x: 10, y: 30, width: 8, height: 20 }]);
    renderer.render();

    expect(mock.beginFrameCount).toBe(1);
    expect(mock.endFrameCount).toBe(1);
    expect(mock.lines.length).toBeGreaterThan(0);
    expect(mock.quads.length).toBeGreaterThan(0);
  });

  test('debug rendering draws debug primitives', () => {
    const mock = new MockRenderer();
    const renderer = new CursorRenderer({ renderer: mock, enableSelection: false, enableDebug: true });

    renderer.updateDebugInfo({
      containerBox: { x: 0, y: 0, width: 100, height: 60 },
      charBoxes: [{ x: 10, y: 20, width: 8, height: 12 }],
      chars: ['A'],
      lines: [{ startIndex: 0, endIndex: 0, y: 20, height: 12, charCount: 1 }],
      hoverLineIndex: 0,
      gapPositions: [{ x: 0, y: 20, height: 10, strong: true }]
    });

    renderer.render();
    expect(mock.texts.some((t) => t.text === '0')).toBe(true);
    expect(mock.lines.length).toBeGreaterThan(0);
    expect(mock.quads.length).toBeGreaterThan(0);
  });

  test('merged selection strategy reduces quad count for contiguous boxes', () => {
    const mock = new MockRenderer();
    const renderer = new CursorRenderer({ renderer: mock, enableSelection: true, enableDebug: false });
    renderer.setSelectionStyle({ strategy: 'merged' });

    renderer.updateSelection([
      { x: 10, y: 20, width: 10, height: 12 },
      { x: 20, y: 20, width: 10, height: 12 },
      { x: 30, y: 20, width: 10, height: 12 }
    ]);
    renderer.render();

    expect(mock.quads.length).toBe(1);
  });

  test('visibility and dispose lifecycle work', () => {
    const mock = new MockRenderer();
    const renderer = new CursorRenderer({
      renderer: mock,
      enableSelection: true,
      enableDebug: true,
      cursorStyle: { blinkEnabled: false }
    });

    renderer.hide();
    renderer.updateCursor({ x: 10, y: 10 }, 10);
    renderer.updateSelection([{ x: 10, y: 10, width: 5, height: 5 }]);
    renderer.render();
    expect(mock.lines.length).toBe(0);
    expect(mock.quads.length).toBe(0);

    renderer.show();
    renderer.render();
    expect(mock.lines.length).toBeGreaterThan(0);

    renderer.dispose();
    expect(mock.destroyed).toBe(true);
  });
});
