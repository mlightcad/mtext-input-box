import * as THREE from 'three';
import type {
  BoxOptions,
  I3DRenderer,
  LineOptions,
  QuadOptions,
  TextOptions,
  Transform
} from './types';

function parseColor(input: string): { color: THREE.Color; alpha: number } {
  const rgba = input.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const raw = rgba[1] ?? '';
    const parts = raw.split(',').map((part) => Number(part.trim()));
    const [r = 255, g = 255, b = 255, a = 1] = parts;
    return { color: new THREE.Color(r / 255, g / 255, b / 255), alpha: Number.isFinite(a) ? a : 1 };
  }

  const color = new THREE.Color();
  color.setStyle(input);
  return { color, alpha: 1 };
}

/** Constructor options for `ThreeJsRendererAdapter`. */
export interface ThreeJsRendererAdapterOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/**
 * Three.js adapter implementing the shared renderer contract.
 *
 * The adapter uses immediate-mode style primitives every frame and applies the
 * active transform directly to draw coordinates for predictable zoom behavior.
 */
export class ThreeJsRendererAdapter implements I3DRenderer {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly frameGroup = new THREE.Group();
  private currentTransform: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

  /** Creates the adapter and registers an internal render group in scene. */
  constructor(options: ThreeJsRendererAdapterOptions) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.scene.add(this.frameGroup);
  }

  initialize(canvas: HTMLCanvasElement): void {
    void canvas;
  }

  destroy(): void {
    this.clearFrame();
    this.scene.remove(this.frameGroup);
  }

  /** Clears frame-local objects before rendering next frame. */
  beginFrame(): void {
    this.clearFrame();
  }

  endFrame(): void {
    void this.camera;
  }

  /** Draws a transformed quad primitive. */
  drawQuad(options: QuadOptions): void {
    const scaleX = this.currentTransform.scaleX ?? 1;
    const scaleY = this.currentTransform.scaleY ?? 1;
    const pos = this.transformPoint(options.x + options.width / 2, options.y);
    const mesh = this.createQuadMesh(
      pos.x - (options.width * scaleX) / 2,
      pos.y,
      Math.abs(options.width * scaleX),
      Math.abs(options.height * scaleY),
      options.fillColor,
      options.opacity
    );
    if (mesh) this.frameGroup.add(mesh);

    if (options.borderColor) {
      const border = this.createRectBorder(
        pos.x - (options.width * scaleX) / 2,
        pos.y,
        Math.abs(options.width * scaleX),
        Math.abs(options.height * scaleY),
        options.borderColor,
        options.borderWidth ?? 1,
        options.opacity ?? 1
      );
      this.frameGroup.add(border);
    }
  }

  /** Draws a transformed line; solid lines are rendered as quads for visible width. */
  drawLine(options: LineOptions): void {
    const p1 = this.transformPoint(options.x1, options.y1);
    const p2 = this.transformPoint(options.x2, options.y2);
    const parsed = parseColor(options.color);
    const alpha = (options.opacity ?? 1) * parsed.alpha;

    if (options.dashed && options.dashed.length > 0) {
      const points = [new THREE.Vector3(p1.x, p1.y, 0), new THREE.Vector3(p2.x, p2.y, 0)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({
        color: parsed.color,
        linewidth: options.width ?? 1,
        transparent: alpha < 1,
        opacity: alpha,
        dashSize: options.dashed[0] ?? 4,
        gapSize: options.dashed[1] ?? 2,
        depthTest: false
      });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = options.renderOrder ?? 1;
      this.frameGroup.add(line);
      return;
    }

    const visualWidth = Math.max(
      1,
      (options.width ?? 1) * ((Math.abs(this.currentTransform.scaleX ?? 1) + Math.abs(this.currentTransform.scaleY ?? 1)) / 2)
    );
    const quad = this.createLineQuad(p1, p2, visualWidth, parsed.color, alpha);
    quad.renderOrder = options.renderOrder ?? 1;
    this.frameGroup.add(quad);
  }

  drawText(options: TextOptions): void {
    const font = options.font ?? '20px monospace';
    const fontPx = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 20);
    const padding = 4;

    const canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = font;

    const measuredWidth = Math.max(1, Math.ceil(ctx.measureText(options.text).width));
    const textWidth = measuredWidth + padding * 2;
    const textHeight = Math.max(1, Math.ceil(fontPx * 1.4));

    canvas.width = textWidth;
    canvas.height = textHeight;
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    const align = options.align ?? 'left';
    const baseline = options.baseline ?? 'top';
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    const parsed = parseColor(options.color);
    ctx.fillStyle = `rgba(${Math.round(parsed.color.r * 255)}, ${Math.round(parsed.color.g * 255)}, ${Math.round(parsed.color.b * 255)}, ${options.opacity ?? parsed.alpha})`;

    const drawX = align === 'center' ? canvas.width / 2 : align === 'right' ? canvas.width - padding : padding;
    const drawY = baseline === 'middle' ? canvas.height / 2 : baseline === 'bottom' ? canvas.height - padding : padding;
    ctx.fillText(options.text, drawX, drawY);

    const isYUp = this.isYAxisUp();

    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = isYUp;
    texture.needsUpdate = true;

    const sx = Math.abs(this.currentTransform.scaleX ?? 1);
    const sy = Math.abs(this.currentTransform.scaleY ?? 1);
    const worldW = Math.max(1, canvas.width * sx);
    const worldH = Math.max(1, canvas.height * sy);

    const geometry = new THREE.PlaneGeometry(worldW, worldH);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);

    const pos = this.transformPoint(options.x, options.y);
    const anchorX = align === 'center' ? 0 : align === 'right' ? -worldW / 2 : worldW / 2;
    const anchorY = baseline === 'middle'
      ? 0
      : baseline === 'bottom'
        ? isYUp ? worldH / 2 : -worldH / 2
        : isYUp ? -worldH / 2 : worldH / 2;
    mesh.position.set(pos.x + anchorX, pos.y + anchorY, 0.2);
    mesh.renderOrder = 10;
    this.frameGroup.add(mesh);
  }

  drawBox(options: BoxOptions): void {
    const scaleX = this.currentTransform.scaleX ?? 1;
    const scaleY = this.currentTransform.scaleY ?? 1;
    const pos = this.transformPoint(options.box.x + options.box.width / 2, options.box.y);

    const border = this.createRectBorder(
      pos.x - (options.box.width * scaleX) / 2,
      pos.y,
      Math.abs(options.box.width * scaleX),
      Math.abs(options.box.height * scaleY),
      options.color,
      options.lineWidth ?? 1,
      options.opacity ?? 1
    );
    border.renderOrder = options.renderOrder ?? 2;
    this.frameGroup.add(border);
  }

  /** Sets active view transform applied to subsequent draw calls. */
  setTransform(transform: Transform): void {
    this.currentTransform = {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      scaleX: transform.scaleX ?? 1,
      scaleY: transform.scaleY ?? 1,
      rotation: transform.rotation ?? 0
    };
  }

  resetTransform(): void {
    this.currentTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  }

  private transformPoint(x: number, y: number): { x: number; y: number } {
    const scaleX = this.currentTransform.scaleX ?? 1;
    const scaleY = this.currentTransform.scaleY ?? 1;
    const tx = (this.currentTransform.x ?? 0) + x * scaleX;
    const ty = (this.currentTransform.y ?? 0) + y * scaleY;
    const rotation = this.currentTransform.rotation ?? 0;
    if (rotation === 0) return { x: tx, y: ty };

    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return { x: tx * c - ty * s, y: tx * s + ty * c };
  }

  private isYAxisUp(): boolean {
    if (this.camera instanceof THREE.OrthographicCamera) {
      return this.camera.top >= this.camera.bottom;
    }
    return true;
  }

  private createLineQuad(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    width: number,
    color: THREE.Color,
    opacity: number
  ): THREE.Mesh {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);

    const geometry = new THREE.PlaneGeometry(length, width);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0);
    mesh.rotation.z = angle;
    return mesh;
  }

  private createQuadMesh(
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor?: string,
    opacity = 1
  ): THREE.Mesh | null {
    if (!fillColor) return null;
    const geometry = new THREE.PlaneGeometry(width, height);
    const parsed = parseColor(fillColor);
    const material = new THREE.MeshBasicMaterial({
      color: parsed.color,
      transparent: opacity * parsed.alpha < 1,
      opacity: opacity * parsed.alpha,
      side: THREE.DoubleSide,
      depthTest: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x + width / 2, y, 0);
    mesh.renderOrder = 1;
    return mesh;
  }

  private createRectBorder(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
    opacity: number
  ): THREE.LineLoop {
    const parsed = parseColor(color);
    const hw = width / 2;
    const hh = height / 2;
    const cx = x + hw;
    const cy = y;
    const points = [
      new THREE.Vector3(cx - hw, cy - hh, 0),
      new THREE.Vector3(cx + hw, cy - hh, 0),
      new THREE.Vector3(cx + hw, cy + hh, 0),
      new THREE.Vector3(cx - hw, cy + hh, 0)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: parsed.color,
      transparent: opacity * parsed.alpha < 1,
      opacity: opacity * parsed.alpha,
      linewidth: lineWidth,
      depthTest: false
    });
    return new THREE.LineLoop(geometry, material);
  }

  private clearFrame(): void {
    while (this.frameGroup.children.length > 0) {
      const child = this.frameGroup.children.pop();
      if (!child) continue;
      this.disposeObject(child);
    }
  }

  private disposeObject(obj: THREE.Object3D): void {
    if ('geometry' in obj && obj.geometry instanceof THREE.BufferGeometry) {
      obj.geometry.dispose();
    }

    if ('material' in obj) {
      const material = obj.material;
      if (Array.isArray(material)) {
        material.forEach((item) => this.disposeMaterial(item));
      } else if (material) {
        this.disposeMaterial(material as THREE.Material);
      }
    }

    if ('children' in obj && obj.children.length > 0) {
      [...obj.children].forEach((child) => this.disposeObject(child));
    }

    obj.removeFromParent();
  }

  private disposeMaterial(material: THREE.Material): void {
    const matWithMap = material as THREE.Material & { map?: THREE.Texture };
    if (matWithMap.map) matWithMap.map.dispose();
    material.dispose();
  }
}
