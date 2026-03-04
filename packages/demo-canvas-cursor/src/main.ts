import { Canvas2DRendererAdapter, CursorRenderer, TextBoxCursor } from '@mlightcad/text-box-cursor';
import type { DebugData } from '@mlightcad/text-box-cursor';
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
  opt.textContent = `📘 ${data.name}`;
  sceneSelect.append(opt);
}
sceneSelect.value = defaultCase.id;

type Runtime = {
  currentCase: DemoCase;
  cursor: TextBoxCursor;
  renderer: CursorRenderer;
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
    verticalAlign: 'center',
    debug: true
  });
}

const runtime: Runtime = {
  currentCase: defaultCase,
  cursor: createCursor(defaultCase, Number(tolerance.value)),
  renderer: new CursorRenderer({
    renderer: new Canvas2DRendererAdapter(canvas),
    enableDebug: true,
    enableSelection: true,
    cursorStyle: {
      color: '#00f5ff',
      glowColor: '#00f5ff',
      glowIntensity: 0.95,
      blinkEnabled: true,
      width: 4.5,
      heightMode: 'lineHeight',
      mode: 'sprite'
    },
    selectionStyle: {
      fillColor: 'rgba(0,120,255,0.30)',
      blendMode: 'normal',
      strategy: 'perChar'
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
}

function updateStatus(): void {
  const cursor = runtime.cursor.getCursorState();
  const selection = runtime.cursor.getSelection();
  const line = cursor.lineInfo;
  const lines = runtime.cursor.getLines();
  const direction = selection
    ? selection.isCollapsed
      ? 'Collapsed'
      : selection.isBackwards
        ? 'Backward'
        : 'Forward'
    : 'None';

  status.textContent = [
    'Cursor State',
    `Index: ${cursor.index} / ${runtime.cursor.getCharBoxes().length}`,
    `Position: (${Math.round(cursor.position.x)}, ${Math.round(cursor.position.y)})`,
    `Line: ${cursor.lineIndex < 0 ? '-' : cursor.lineIndex + 1} / ${lines.length}`,
    `Line Range: [${line.startIndex}, ${line.endIndex}]`,
    '',
    'Selection',
    selection
      ? `Range: [${selection.start}, ${selection.end}) · ${selection.end - selection.start}chars`
      : 'Range: -',
    `Direction: ${direction}`,
    `Selected Lines: ${selection?.selectedLines.join(', ') || '-'}`,
    '',
    'Line Detection Parameters',
    `Tolerance: ${tolerance.value}px`,
    `Zoom: ${Math.round(runtime.zoom * 100)}%`,
    `lineBreakIndices: ${runtime.currentCase.lineBreakIndices?.length ? `[${runtime.currentCase.lineBreakIndices.join(', ')}]` : '-'}`,
    `Detected Lines: ${lines.length}`,
    `Line Heights: [${lines.map((item) => Math.round(item.height)).join(', ')}]`
  ].join('\n');
}

function render(): void {
  const cursorState = runtime.cursor.getCursorState();
  const selection = runtime.cursor.getSelection();

  runtime.renderer.setDebugMode(runtime.debugOn);
  runtime.renderer.setViewTransform({ x: 0, y: 0, scaleX: runtime.zoom, scaleY: runtime.zoom });
  runtime.renderer.setSelectionStyle({
    fillColor: runtime.dragSelecting
      ? 'rgba(0,200,255,0.25)'
      : selection?.isBackwards
        ? 'rgba(150,0,255,0.25)'
        : 'rgba(0,120,255,0.30)'
  });

  runtime.renderer.updateCursor(cursorState.position, cursorState.lineInfo.height);
  runtime.renderer.updateSelection(runtime.cursor.getSelectedCharBoxes());
  runtime.renderer.updateDebugInfo(buildDebugData());
  runtime.renderer.render();

  updateStatus();
  requestAnimationFrame(render);
}

function switchScene(next: DemoCase): void {
  runtime.currentCase = next;
  runtime.cursor.destroy();
  runtime.cursor = createCursor(next, Number(tolerance.value));
}

function pointerPos(event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const rawX = (event.clientX - rect.left) * scaleX;
  const rawY = (event.clientY - rect.top) * scaleY;
  return { x: rawX / runtime.zoom, y: rawY / runtime.zoom };
}

sceneSelect.addEventListener('change', () => {
  switchScene(sceneById(sceneSelect.value));
});

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
  runtime.renderer.dispose();
  runtime.cursor.destroy();
});

toleranceValue.textContent = `${tolerance.value}px`;
applyZoom(1);
render();
