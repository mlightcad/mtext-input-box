import { MTextInputBox, parseMTextToAst } from '@mlightcad/mtext-input-box';
import { diffWordsWithSpace } from 'diff';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface JsonEditorInstance {
  set(data: unknown): void;
  destroy(): void;
}

interface DemoEditor {
  id: string;
  label: string;
  origin: THREE.Vector3;
  editor: MTextInputBox;
}

type JsonEditorConstructor = new (
  container: HTMLElement,
  options?: Record<string, unknown>
) => JsonEditorInstance;

function requireNode<T>(node: T | null, id: string): T {
  if (!node) throw new Error(`Missing node: ${id}`);
  return node;
}

function normalizeColorNumber(color: number): number {
  return Math.max(0, Math.min(0xffffff, Math.round(color)));
}

function colorNumberToHex(color: number | null): string {
  if (color === null) return '-';
  return `#${normalizeColorNumber(color).toString(16).padStart(6, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInlineDiffHtml(previousText: string, currentText: string): string {
  if (previousText === currentText) {
    return '<span class="diff-token diff-token-same">No changes</span>';
  }

  return diffWordsWithSpace(previousText, currentText)
    .map((part) => {
      const text = escapeHtml(part.value);

      if (part.added) {
        return `<ins class="diff-token diff-token-add">${text}</ins>`;
      }

      if (part.removed) {
        return `<del class="diff-token diff-token-remove">${text}</del>`;
      }

      return `<span class="diff-token diff-token-same">${text}</span>`;
    })
    .join('');
}

const canvas = requireNode(document.querySelector<HTMLCanvasElement>('#stage'), '#stage');
const status = requireNode(document.querySelector<HTMLElement>('#status'), '#status');
const toggleThemeBtn = requireNode(document.querySelector<HTMLButtonElement>('#toggleThemeBtn'), '#toggleThemeBtn');
const debugEnabled = requireNode(document.querySelector<HTMLInputElement>('#debugEnabled'), '#debugEnabled');
const debugShowBoxes = requireNode(document.querySelector<HTMLInputElement>('#debugShowBoxes'), '#debugShowBoxes');
const debugShowChars = requireNode(document.querySelector<HTMLInputElement>('#debugShowChars'), '#debugShowChars');
const debugShowCharIndices = requireNode(document.querySelector<HTMLInputElement>('#debugShowCharIndices'), '#debugShowCharIndices');
const debugShowLineIndices = requireNode(document.querySelector<HTMLInputElement>('#debugShowLineIndices'), '#debugShowLineIndices');
const tabInfo = requireNode(document.querySelector<HTMLButtonElement>('#tabInfo'), '#tabInfo');
const tabAst = requireNode(document.querySelector<HTMLButtonElement>('#tabAst'), '#tabAst');
const tabCursorLayout = requireNode(
  document.querySelector<HTMLButtonElement>('#tabCursorLayout'),
  '#tabCursorLayout'
);
const tabRaw = requireNode(document.querySelector<HTMLButtonElement>('#tabRaw'), '#tabRaw');
const tabPaneInfo = requireNode(document.querySelector<HTMLElement>('#tabPaneInfo'), '#tabPaneInfo');
const tabPaneAst = requireNode(document.querySelector<HTMLElement>('#tabPaneAst'), '#tabPaneAst');
const tabPaneCursorLayout = requireNode(
  document.querySelector<HTMLElement>('#tabPaneCursorLayout'),
  '#tabPaneCursorLayout'
);
const tabPaneRaw = requireNode(document.querySelector<HTMLElement>('#tabPaneRaw'), '#tabPaneRaw');
const rawMText = requireNode(document.querySelector<HTMLTextAreaElement>('#rawMText'), '#rawMText');
const mtextDiff = requireNode(document.querySelector<HTMLElement>('#mtextDiff'), '#mtextDiff');
const astEditorContainer = requireNode(document.querySelector<HTMLElement>('#astEditor'), '#astEditor');
const cursorLayoutEditorContainer = requireNode(
  document.querySelector<HTMLElement>('#cursorLayoutEditor'),
  '#cursorLayoutEditor'
);

const JSONEditorCtor = (window as unknown as { JSONEditor?: JsonEditorConstructor }).JSONEditor;
const astEditor: JsonEditorInstance | null = JSONEditorCtor
  ? new JSONEditorCtor(astEditorContainer, {
      mode: 'tree',
      mainMenuBar: false,
      navigationBar: true,
      statusBar: true,
      search: true,
      onEditable: () => false
    })
  : null;
const cursorLayoutEditor: JsonEditorInstance | null = JSONEditorCtor
  ? new JSONEditorCtor(cursorLayoutEditorContainer, {
      mode: 'tree',
      mainMenuBar: false,
      navigationBar: true,
      statusBar: true,
      search: true,
      onEditable: () => false
    })
  : null;

if (!astEditor) {
  astEditorContainer.textContent =
    'JSONEditor is not available. Please check network access to cdn.jsdelivr.net.';
}
if (!cursorLayoutEditor) {
  cursorLayoutEditorContainer.textContent =
    'JSONEditor is not available. Please check network access to cdn.jsdelivr.net.';
}

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1e1e2e');

const WORLD_WIDTH = 1500;
const WORLD_HEIGHT = 900;

const camera = new THREE.OrthographicCamera(0, WORLD_WIDTH, WORLD_HEIGHT, 0, -1000, 1000);
camera.position.set(0, 0, 100);
camera.lookAt(new THREE.Vector3(0, 0, 0));

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(window.devicePixelRatio);

function syncRendererSizeToCanvas(): void {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  renderer.setSize(width, height, false);
}

syncRendererSizeToCanvas();
window.addEventListener('resize', syncRendererSizeToCanvas);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enablePan = true;
controls.enableZoom = true;
controls.zoomSpeed = 1.1;
controls.screenSpacePanning = true;
controls.minZoom = 0.3;
controls.maxZoom = 5;

const defaultFormat = {
  fontFamily: 'simkai',
  fontSize: 22,
  bold: false,
  italic: false,
  underline: false,
  overline: false,
  strike: false,
  script: 'normal' as const,
  aci: null,
  rgb: 0xffffff
};

const editors: DemoEditor[] = [
  {
    id: 'A',
    label: 'Editor A',
    origin: new THREE.Vector3(70, 540, 0),
    editor: new MTextInputBox({
      scene,
      camera,
      width: 280,
      position: new THREE.Vector3(70, 540, 0),
      initialText: '{\\C10;Header A}\\PMulti-editor demo A\\P\\S1/2; + \\S3/4;',
      defaultFormat,
      imeTarget: canvas,
      toolbar: { enabled: true, theme: 'dark', offsetY: 12 }
    })
  },
  {
    id: 'B',
    label: 'Editor B',
    origin: new THREE.Vector3(370, 380, 0),
    editor: new MTextInputBox({
      scene,
      camera,
      width: 300,
      position: new THREE.Vector3(370, 380, 0),
      initialText: '{\\C3;Second block}\\PUnicode: \\U+4F60\\U+597D\\PLine 3',
      defaultFormat,
      imeTarget: canvas,
      toolbar: { enabled: true, theme: 'dark', offsetY: 12 }
    })
  },
  {
    id: 'C',
    label: 'Editor C',
    origin: new THREE.Vector3(170, 200, 0),
    editor: new MTextInputBox({
      scene,
      camera,
      width: 360,
      position: new THREE.Vector3(170, 200, 0),
      initialText: '{\\FArial|b1;Third} \\S2^ ; sample\\PClick any box to activate',
      defaultFormat,
      imeTarget: canvas,
      toolbar: { enabled: true, theme: 'dark', offsetY: 12 }
    })
  }
];

const previousMTextByEditor = editors.map((item) => item.editor.getText());
let activeEditorIndex: number | null = 0;
let mouseWcs: THREE.Vector3 | null = null;
let mouseEditor: { x: number; y: number } | null = null;

function getActiveEditorItem(): DemoEditor | null {
  if (activeEditorIndex === null) return null;
  return editors[activeEditorIndex] ?? null;
}

function applyDebugControls(): void {
  for (const item of editors) {
    item.editor.setDebugMode(debugEnabled.checked);
    item.editor.setDebugVisibility({
      showCharBoxes: debugShowBoxes.checked,
      showChars: debugShowChars.checked,
      showCharIndices: debugShowCharIndices.checked,
      showLineIndices: debugShowLineIndices.checked
    });
  }
}

applyDebugControls();

function setActiveEditor(index: number | null): void {
  if (index === null || !editors[index]) {
    activeEditorIndex = null;
    updateAstView();
    updateRawDiffView();
    updateCursorLayoutView();
    return;
  }

  activeEditorIndex = index;
  updateAstView();
  updateRawDiffView();
  updateCursorLayoutView();
}

function setActiveTab(tab: 'info' | 'ast' | 'cursorLayout' | 'raw'): void {
  const isInfo = tab === 'info';
  const isAst = tab === 'ast';
  const isCursorLayout = tab === 'cursorLayout';
  const isRaw = tab === 'raw';

  tabInfo.classList.toggle('is-active', isInfo);
  tabAst.classList.toggle('is-active', isAst);
  tabCursorLayout.classList.toggle('is-active', isCursorLayout);
  tabRaw.classList.toggle('is-active', isRaw);

  tabInfo.setAttribute('aria-selected', isInfo ? 'true' : 'false');
  tabAst.setAttribute('aria-selected', isAst ? 'true' : 'false');
  tabCursorLayout.setAttribute('aria-selected', isCursorLayout ? 'true' : 'false');
  tabRaw.setAttribute('aria-selected', isRaw ? 'true' : 'false');

  tabPaneInfo.classList.toggle('is-active', isInfo);
  tabPaneAst.classList.toggle('is-active', isAst);
  tabPaneCursorLayout.classList.toggle('is-active', isCursorLayout);
  tabPaneRaw.classList.toggle('is-active', isRaw);
}

tabInfo.addEventListener('click', () => setActiveTab('info'));
tabAst.addEventListener('click', () => setActiveTab('ast'));
tabCursorLayout.addEventListener('click', () => {
  setActiveTab('cursorLayout');
  updateCursorLayoutView();
});
tabRaw.addEventListener('click', () => setActiveTab('raw'));

function updateAstView(): void {
  if (!astEditor) return;
  const active = getActiveEditorItem();
  if (!active) {
    astEditor.set({ info: 'No active editor. Click one text box to activate.' });
    return;
  }

  try {
    const ast = parseMTextToAst(active.editor.getText());
    astEditor.set(ast);
  } catch (error) {
    astEditor.set({ error: String(error) });
  }
}

function updateRawDiffView(): void {
  const active = getActiveEditorItem();
  if (!active || activeEditorIndex === null) {
    rawMText.value = '';
    mtextDiff.innerHTML = '<span class="diff-token diff-token-same">No active editor</span>';
    return;
  }

  const currentMText = active.editor.getText();
  rawMText.value = currentMText;
  mtextDiff.innerHTML = buildInlineDiffHtml(previousMTextByEditor[activeEditorIndex] ?? '', currentMText);
  previousMTextByEditor[activeEditorIndex] = currentMText;
}

function updateCursorLayoutView(): void {
  if (!cursorLayoutEditor) return;
  const active = getActiveEditorItem();
  if (!active) {
    cursorLayoutEditor.set({ info: 'No active editor. Click one text box to activate.' });
    return;
  }
  cursorLayoutEditor.set(active.editor.getCursorLayoutData());
}

toggleThemeBtn.addEventListener('click', () => {
  const active = getActiveEditorItem();
  if (!active) return;
  active.editor.setToolbarTheme(active.editor.getToolbarTheme() === 'dark' ? 'light' : 'dark');
});

for (const input of [debugEnabled, debugShowBoxes, debugShowChars, debugShowCharIndices, debugShowLineIndices]) {
  input.addEventListener('change', applyDebugControls);
}

function screenToWorldOnZ0(event: MouseEvent): THREE.Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const nearPoint = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);
  const farPoint = new THREE.Vector3(ndcX, ndcY, 1).unproject(camera);
  const rayDir = farPoint.sub(nearPoint);

  if (Math.abs(rayDir.z) < 1e-8) return null;

  const t = (0 - nearPoint.z) / rayDir.z;
  return nearPoint.add(rayDir.multiplyScalar(t));
}

canvas.addEventListener('mousemove', (event) => {
  const world = screenToWorldOnZ0(event);
  mouseWcs = world;
  const active = getActiveEditorItem();
  if (!active || !world) {
    mouseEditor = null;
    return;
  }
  mouseEditor = {
    x: world.x - active.origin.x,
    y: world.y - active.origin.y
  };
});

editors.forEach((item, index) => {
  item.editor.on('change', () => {
    setActiveEditor(index);
  });
  item.editor.on('selectionChange', () => {
    setActiveEditor(index);
  });
  item.editor.on('cursorMove', () => {
    setActiveEditor(index);
  });
  item.editor.on('show', () => {
    setActiveEditor(index);
  });
  item.editor.on('close', () => {
    if (activeEditorIndex === index) {
      setActiveEditor(null);
    }
  });
});

setActiveEditor(0);

function updateStatus(): void {
  const active = getActiveEditorItem();
  if (!active) {
    status.textContent = [
      `Editors: ${editors.map((item) => item.label).join(', ')}`,
      'Active Editor: none',
      `Camera Zoom: ${camera.zoom.toFixed(2)}`,
      `Mouse WCS: ${mouseWcs ? `(${mouseWcs.x.toFixed(2)}, ${mouseWcs.y.toFixed(2)}, ${mouseWcs.z.toFixed(2)})` : '-'}`
    ].join('\n');
    return;
  }

  const state = active.editor.getState();
  const range = active.editor.getSelectionRange();
  const defaultTextStyle = active.editor.getDefaultTextStyle();
  const debugVisibility = active.editor.getDebugVisibility();

  debugEnabled.checked = active.editor.isDebugMode();
  debugShowBoxes.checked = debugVisibility.showCharBoxes;
  debugShowChars.checked = debugVisibility.showChars;
  debugShowCharIndices.checked = debugVisibility.showCharIndices;
  debugShowLineIndices.checked = debugVisibility.showLineIndices;

  status.textContent = [
    `Editors: ${editors.map((item, index) => `${index === activeEditorIndex ? '*' : '-'} ${item.label}`).join(', ')}`,
    `Active Editor: ${active.label} (${active.id})`,
    `Debug: ${active.editor.isDebugMode() ? 'On' : 'Off'}`,
    `Toolbar Theme: ${active.editor.getToolbarTheme()}`,
    `Debug Char Boxes: ${debugVisibility.showCharBoxes ? 'On' : 'Off'}`,
    `Debug Chars: ${debugVisibility.showChars ? 'On' : 'Off'}`,
    `Debug Indices: ${debugVisibility.showCharIndices ? 'On' : 'Off'}`,
    `Debug Line Indices: ${debugVisibility.showLineIndices ? 'On' : 'Off'}`,
    `Camera Zoom: ${camera.zoom.toFixed(2)}`,
    `Mouse WCS: ${mouseWcs ? `(${mouseWcs.x.toFixed(2)}, ${mouseWcs.y.toFixed(2)}, ${mouseWcs.z.toFixed(2)})` : '-'}`,
    `Mouse Active Editor Local: ${mouseEditor ? `(${mouseEditor.x.toFixed(2)}, ${mouseEditor.y.toFixed(2)})` : '-'}`,
    `Cursor: ${state.cursorIndex}`,
    `Selection: [${range.start}, ${range.end})`,
    'Current Format:',
    JSON.stringify(state.currentFormat, null, 2),
    '',
    `Current ACI: ${state.currentFormat.aci === null ? 'null' : state.currentFormat.aci}`,
    `Current RGB (hex): ${colorNumberToHex(state.currentFormat.rgb)}`,
    'Default Text Style:',
    JSON.stringify(defaultTextStyle, null, 2),
    `Default Text Style Color (hex): ${colorNumberToHex(defaultTextStyle.color)}`
  ].join('\n');
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  for (const item of editors) {
    item.editor.update();
  }
  renderer.render(scene, camera);
  updateStatus();
}

animate();

window.addEventListener('beforeunload', () => {
  window.removeEventListener('resize', syncRendererSizeToCanvas);
  astEditor?.destroy();
  cursorLayoutEditor?.destroy();
  controls.dispose();
  for (const item of editors) {
    item.editor.dispose();
  }
  renderer.dispose();
});
