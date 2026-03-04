import {
  CursorRenderer,
  TextBoxCursor,
  ThreeJsRendererAdapter,
  type DebugData
} from '@mlightcad/text-box-cursor';
import * as THREE from 'three';
import { demoCases, type DemoCase } from './data';

function requireNode<T>(node: T | null, selector: string): T {
  if (!node) throw new Error(`Missing required DOM node: ${selector}`);
  return node;
}

const canvas = requireNode(document.querySelector<HTMLCanvasElement>('#stage'), '#stage');
const status = requireNode(document.querySelector<HTMLElement>('#status'), '#status');
const sceneSelect = requireNode(document.querySelector<HTMLSelectElement>('#sceneSelect'), '#sceneSelect');
const tolerance = requireNode(document.querySelector<HTMLInputElement>('#tolerance'), '#tolerance');
const toleranceValue = requireNode(document.querySelector<HTMLElement>('#toleranceValue'), '#toleranceValue');
const zoomInBtn = requireNode(document.querySelector<HTMLButtonElement>('#zoomInBtn'), '#zoomInBtn');
const zoomOutBtn = requireNode(document.querySelector<HTMLButtonElement>('#zoomOutBtn'), '#zoomOutBtn');
const zoomResetBtn = requireNode(
  document.querySelector<HTMLButtonElement>('#zoomResetBtn'),
  '#zoomResetBtn'
);
const zoomValue = requireNode(document.querySelector<HTMLElement>('#zoomValue'), '#zoomValue');
const dragToggle = requireNode(document.querySelector<HTMLInputElement>('#dragToggle'), '#dragToggle');
const leftBtn = requireNode(document.querySelector<HTMLButtonElement>('#leftBtn'), '#leftBtn');
const rightBtn = requireNode(document.querySelector<HTMLButtonElement>('#rightBtn'), '#rightBtn');
const upBtn = requireNode(document.querySelector<HTMLButtonElement>('#upBtn'), '#upBtn');
const downBtn = requireNode(document.querySelector<HTMLButtonElement>('#downBtn'), '#downBtn');
const selectAllBtn = requireNode(
  document.querySelector<HTMLButtonElement>('#selectAllBtn'),
  '#selectAllBtn'
);
const clearSelectionBtn = requireNode(
  document.querySelector<HTMLButtonElement>('#clearSelectionBtn'),
  '#clearSelectionBtn'
);
const toggleDebugBtn = requireNode(
  document.querySelector<HTMLButtonElement>('#toggleDebugBtn'),
  '#toggleDebugBtn'
);

if (demoCases.length === 0) throw new Error('No demo cases provided');
const defaultCase: DemoCase = demoCases[0]!;

for (const data of demoCases) {
  const opt = document.createElement('option');
  opt.value = data.id;
  opt.textContent = `📙 ${data.name}`;
  sceneSelect.append(opt);
}
sceneSelect.value = defaultCase.id;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1e1e2e');

// Y axis goes downward to match DOM/canvas coordinates.
const camera = new THREE.OrthographicCamera(0, 1000, 0, 600, -1000, 1000);
camera.position.set(0, 0, 100);
camera.lookAt(new THREE.Vector3(0, 0, 0));

const webglRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
webglRenderer.setPixelRatio(window.devicePixelRatio);
webglRenderer.setSize(1000, 600, false);

const adapter = new ThreeJsRendererAdapter({ scene, camera });
const textGroup = new THREE.Group();
scene.add(textGroup);

const TEXT_FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

type Runtime = {
  currentCase: DemoCase;
  cursor: TextBoxCursor;
  cursorRenderer: CursorRenderer;
  debugOn: boolean;
  hoverLineIndex: number;
  dragSelecting: boolean;
  zoom: number;
};

function createCursor(data: DemoCase, tolerancePx: number): TextBoxCursor {
  const lineBreakOption = data.lineBreakIndices ? { lineBreakIndices: data.lineBreakIndices } : {};
  const lineLayoutOption = data.lineLayouts ? { lineLayouts: data.lineLayouts } : {};
  return new TextBoxCursor({
    containerBox: data.containerBox,
    charBoxes: data.charBoxes,
    ...lineBreakOption,
    ...lineLayoutOption,
    lineTolerance: tolerancePx,
    verticalAlign: 'center'
  });
}

const runtime: Runtime = {
  currentCase: defaultCase,
  cursor: createCursor(defaultCase, Number(tolerance.value)),
  cursorRenderer: new CursorRenderer({
    renderer: adapter,
    enableDebug: true,
    cursorStyle: {
      blinkEnabled: true,
      width: 4.5,
      color: '#00f5ff',
      glowColor: '#00f5ff',
      glowIntensity: 0.95
    }
  }),
  debugOn: true,
  hoverLineIndex: -1,
  dragSelecting: false,
  zoom: 1
};

function sceneById(id: string): DemoCase {
  return demoCases.find((item) => item.id === id) ?? defaultCase;
}

type GapMarker = { x: number; y: number; height: number; strong?: boolean };

function buildGapPositions(cursor: TextBoxCursor): GapMarker[] {
  const lines = cursor.getLines();
  const charBoxes = cursor.getCharBoxes();
  const container = cursor.getContainerBox();
  const gaps: GapMarker[] = [];

  for (const line of lines) {
    gaps.push({ x: container.x, y: line.y, height: line.height * 0.8, strong: true });
    for (let i = line.startIndex; i <= line.endIndex; i++) {
      const box = charBoxes[i];
      if (!box) continue;
      gaps.push({
        x: box.x + box.width,
        y: line.y,
        height: line.height * 0.8,
        strong: i === line.endIndex
      });
    }
  }

  return gaps;
}

function buildDebugData(): DebugData {
  return {
    containerBox: runtime.currentCase.containerBox,
    charBoxes: runtime.cursor.getCharBoxes(),
    chars: runtime.currentCase.chars,
    lines: runtime.cursor.getLines(),
    hoverLineIndex: runtime.hoverLineIndex,
    gapPositions: buildGapPositions(runtime.cursor)
  };
}

function applyZoom(nextZoom: number): void {
  runtime.zoom = Math.min(2.5, Math.max(0.5, nextZoom));
  zoomValue.textContent = `${Math.round(runtime.zoom * 100)}%`;
  textGroup.scale.set(runtime.zoom, runtime.zoom, 1);
}

function disposeTextGroup(): void {
  while (textGroup.children.length > 0) {
    const child = textGroup.children.pop();
    if (!child) continue;
    if (child instanceof THREE.Mesh) {
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of materials) {
        const material = mat as THREE.Material & { map?: THREE.Texture };
        if (material.map) material.map.dispose();
        material.dispose();
      }
    }
    child.removeFromParent();
  }
}

function createCharMesh(char: string, box: { x: number; y: number; width: number; height: number }): THREE.Mesh {
  const scale = 3;
  const canvasEl = document.createElement('canvas');
  const width = Math.max(32, Math.ceil(box.width * scale));
  const height = Math.max(32, Math.ceil(box.height * scale));
  canvasEl.width = width;
  canvasEl.height = height;

  const ctx = canvasEl.getContext('2d');
  if (!ctx) throw new Error('Failed to create 2D context for text mesh');

  const fontPx = Math.max(12, Math.round(box.height * 0.72 * scale));
  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = '#f4f7ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const geometry = new THREE.PlaneGeometry(box.width, box.height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(box.x + box.width / 2, box.y, -0.1);
  mesh.renderOrder = 1;
  return mesh;
}

function rebuildTextMeshes(data: DemoCase): void {
  disposeTextGroup();
  for (let i = 0; i < data.chars.length; i++) {
    const char = data.chars[i];
    const box = data.charBoxes[i];
    if (!char || !box) continue;
    textGroup.add(createCharMesh(char, box));
  }
}

function updateStatus(): void {
  const cursor = runtime.cursor.getCursorState();
  const selection = runtime.cursor.getSelection();
  const line = cursor.lineInfo;
  const lines = runtime.cursor.getLines();

  status.textContent = [
    'Three.js Render State',
    `Cursor Index: ${cursor.index}`,
    `Cursor Position: (${Math.round(cursor.position.x)}, ${Math.round(cursor.position.y)})`,
    `Line: ${cursor.lineIndex < 0 ? '-' : cursor.lineIndex + 1} / ${lines.length}`,
    `Line Range: [${line.startIndex}, ${line.endIndex}]`,
    '',
    'Selection',
    selection ? `[${selection.start}, ${selection.end})` : '-',
    `Direction: ${selection ? (selection.isBackwards ? 'Backward' : 'Forward') : '-'}`,
    '',
    'Parameters',
    `Tolerance: ${tolerance.value}px`,
    `Zoom: ${Math.round(runtime.zoom * 100)}%`,
    `lineBreakIndices: ${runtime.currentCase.lineBreakIndices?.length ? `[${runtime.currentCase.lineBreakIndices.join(', ')}]` : '-'}`,
    `Detected Lines: ${lines.length}`,
    `Debug: ${runtime.debugOn ? 'On' : 'Off'}`
  ].join('\n');
}

function render(): void {
  const cursorState = runtime.cursor.getCursorState();
  const selection = runtime.cursor.getSelection();

  runtime.cursorRenderer.setDebugMode(runtime.debugOn);
  runtime.cursorRenderer.setViewTransform({ x: 0, y: 0, scaleX: runtime.zoom, scaleY: runtime.zoom });
  runtime.cursorRenderer.setSelectionStyle({
    fillColor: runtime.dragSelecting
      ? 'rgba(0,200,255,0.25)'
      : selection?.isBackwards
        ? 'rgba(150,0,255,0.25)'
        : 'rgba(0,120,255,0.30)'
  });
  runtime.cursorRenderer.updateCursor(cursorState.position, cursorState.lineInfo.height);
  runtime.cursorRenderer.updateSelection(runtime.cursor.getSelectedCharBoxes());
  runtime.cursorRenderer.updateDebugInfo(buildDebugData());
  runtime.cursorRenderer.render();

  webglRenderer.render(scene, camera);
  updateStatus();
  requestAnimationFrame(render);
}

function switchScene(next: DemoCase): void {
  runtime.currentCase = next;
  runtime.cursor.destroy();
  runtime.cursor = createCursor(next, Number(tolerance.value));
  rebuildTextMeshes(next);
}

function pointerPos(event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = 1000 / rect.width;
  const scaleY = 600 / rect.height;
  const rawX = (event.clientX - rect.left) * scaleX;
  const rawY = (event.clientY - rect.top) * scaleY;
  return { x: rawX / runtime.zoom, y: rawY / runtime.zoom };
}

sceneSelect.addEventListener('change', () => switchScene(sceneById(sceneSelect.value)));
tolerance.addEventListener('input', () => {
  toleranceValue.textContent = `${tolerance.value}px`;
  runtime.cursor.setLineTolerance(Number(tolerance.value));
});

zoomInBtn.addEventListener('click', () => applyZoom(runtime.zoom + 0.1));
zoomOutBtn.addEventListener('click', () => applyZoom(runtime.zoom - 0.1));
zoomResetBtn.addEventListener('click', () => applyZoom(1));
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  applyZoom(runtime.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
});

leftBtn.addEventListener('click', () => runtime.cursor.moveLeft());
rightBtn.addEventListener('click', () => runtime.cursor.moveRight());
upBtn.addEventListener('click', () => runtime.cursor.moveUp());
downBtn.addEventListener('click', () => runtime.cursor.moveDown());
selectAllBtn.addEventListener('click', () => runtime.cursor.selectAll());
clearSelectionBtn.addEventListener('click', () => runtime.cursor.clearSelection());
toggleDebugBtn.addEventListener('click', () => {
  runtime.debugOn = !runtime.debugOn;
});

canvas.addEventListener('mousemove', (event) => {
  const pos = pointerPos(event);
  runtime.hoverLineIndex = runtime.cursor.hitTestLine(pos.y);
  if (runtime.dragSelecting && dragToggle.checked) {
    runtime.cursor.updateSelectionDrag(pos.x, pos.y);
  }
});

canvas.addEventListener('mousedown', (event) => {
  const pos = pointerPos(event);
  if (dragToggle.checked) {
    runtime.dragSelecting = true;
    runtime.cursor.extendSelectionToClick(pos.x, pos.y);
  } else {
    runtime.cursor.moveToClick(pos.x, pos.y);
  }
});

window.addEventListener('mouseup', () => {
  runtime.dragSelecting = false;
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') runtime.cursor.moveLeft();
  if (event.key === 'ArrowRight') runtime.cursor.moveRight();
  if (event.key === 'ArrowUp') runtime.cursor.moveUp();
  if (event.key === 'ArrowDown') runtime.cursor.moveDown();
  if (event.key === 'Escape') runtime.cursor.clearSelection();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    runtime.cursor.selectAll();
  }
  if (event.key.toLowerCase() === 'd') runtime.debugOn = !runtime.debugOn;
  if (event.key === '-' || event.key === '_') {
    tolerance.value = String(Math.max(0, Number(tolerance.value) - 1));
    toleranceValue.textContent = `${tolerance.value}px`;
    runtime.cursor.setLineTolerance(Number(tolerance.value));
  }
  if (event.key === '=' || event.key === '+') {
    tolerance.value = String(Math.min(30, Number(tolerance.value) + 1));
    toleranceValue.textContent = `${tolerance.value}px`;
    runtime.cursor.setLineTolerance(Number(tolerance.value));
  }
});

window.addEventListener('beforeunload', () => {
  disposeTextGroup();
  runtime.cursorRenderer.dispose();
  runtime.cursor.destroy();
});

toleranceValue.textContent = `${tolerance.value}px`;
rebuildTextMeshes(defaultCase);
applyZoom(1);
render();
