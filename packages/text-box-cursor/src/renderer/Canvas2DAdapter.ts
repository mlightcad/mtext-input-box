import type {
  BoxOptions,
  I3DRenderer,
  LineOptions,
  QuadOptions,
  TextOptions,
  Transform
} from './types';

/**
 * Canvas 2D fallback adapter implementing the shared `I3DRenderer` contract.
 *
 * Useful for debugging and environments where WebGL/Three.js is not desired.
 */
export class Canvas2DRendererAdapter implements I3DRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;

  /** Creates adapter bound to an existing `<canvas>` element. */
  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.canvas = canvas;
  }

  initialize(canvas: HTMLCanvasElement): void {
    void canvas;
    // Already initialized in constructor.
  }

  destroy(): void {
    // No resources to release for the Canvas2D fallback.
  }

  /** Clears frame buffer before draw calls. */
  beginFrame(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  endFrame(): void {
    // No-op for Canvas2D backend.
  }

  /** Draws a filled/stroked axis-aligned rectangle. */
  drawQuad(options: QuadOptions): void {
    const top = options.y - options.height / 2;
    this.ctx.save();
    this.ctx.globalAlpha = options.opacity ?? 1;
    if (options.blendMode) this.ctx.globalCompositeOperation = options.blendMode;

    if (options.fillColor) {
      this.ctx.fillStyle = options.fillColor;
      this.ctx.fillRect(options.x, top, options.width, options.height);
    }

    if (options.borderColor) {
      this.ctx.strokeStyle = options.borderColor;
      this.ctx.lineWidth = options.borderWidth ?? 1;
      this.ctx.strokeRect(options.x, top, options.width, options.height);
    }

    this.ctx.restore();
  }

  /** Draws a solid or dashed line segment. */
  drawLine(options: LineOptions): void {
    this.ctx.save();
    this.ctx.strokeStyle = options.color;
    this.ctx.lineWidth = options.width ?? 1;
    this.ctx.globalAlpha = options.opacity ?? 1;
    this.ctx.setLineDash(options.dashed ?? []);
    this.ctx.beginPath();
    this.ctx.moveTo(options.x1, options.y1);
    this.ctx.lineTo(options.x2, options.y2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Draws debug text. */
  drawText(options: TextOptions): void {
    this.ctx.save();
    this.ctx.fillStyle = options.color;
    this.ctx.globalAlpha = options.opacity ?? 1;
    this.ctx.font = options.font ?? '12px monospace';
    this.ctx.textAlign = options.align ?? 'left';
    this.ctx.textBaseline = options.baseline ?? 'top';
    this.ctx.fillText(options.text, options.x, options.y);
    this.ctx.restore();
  }

  drawBox(options: BoxOptions): void {
    const { box, color } = options;
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = options.opacity ?? 1;
    this.ctx.lineWidth = options.lineWidth ?? 1;
    this.ctx.strokeRect(box.x, box.y - box.height / 2, box.width, box.height);
    this.ctx.restore();
  }

  setTransform(transform: Transform): void {
    this.ctx.save();
    this.ctx.translate(transform.x ?? 0, transform.y ?? 0);
    this.ctx.rotate(transform.rotation ?? 0);
    this.ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
  }

  resetTransform(): void {
    this.ctx.restore();
  }
}
