/**
 * ES 모듈 무결성 검사.
 *
 * **왜 필요한가.** smoke·shot·sim 은 전부 `dist/company-tycoon.html`(번들)을
 * 띄운다. 번들러가 모듈을 **한 스코프로 이어 붙이므로**, import 를 빠뜨려도
 * 다른 모듈의 최상위 이름이 그냥 보인다. 번들에서는 멀쩡하고 `src/` 를 그대로
 * 로드할 때만 `ReferenceError` 로 죽는다 — README 의 '바로 플레이'
 * (GitHub Pages)가 정확히 그 모드다.
 *
 * 실제로 `canvas.js` 가 `HH` 를 import 하지 않고 쓰는 버그가 이 구멍으로
 * 빠져나가, 검증은 전부 통과하는데 배포본만 흰 화면이 나왔다.
 *
 * **어떻게 잡는가.** 정적 분석 대신 **진짜 ESM 그래프를 노드에서 평가한다.**
 * 노드의 import 는 브라우저와 같은 스코프 규칙을 쓰므로, import 누락이면
 * 브라우저와 똑같이 죽는다. jsdom 으로 DOM 만 깔아 준다.
 *
 *   node tools/modcheck.mjs
 *
 * 개발 도구다. 빌드에는 들어가지 않는다.
 */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://localhost/', pretendToBeVisual: true });
const { window: win } = dom;

/* 모듈 최상위에서 DOM 을 만지는 곳이 있다(canvas.js 의 getElementById 등).
   전역에 얹어 두지 않으면 import 자체가 실패해 검사가 무의미해진다. */
globalThis.window = win;
for (const k of [
  'document', 'navigator', 'location', 'localStorage', 'devicePixelRatio',
  'HTMLElement', 'HTMLCanvasElement', 'Event', 'CustomEvent', 'Image',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'ResizeObserver', 'matchMedia',
]) {
  if (globalThis[k] === undefined && win[k] !== undefined) {
    globalThis[k] = typeof win[k] === 'function' ? win[k].bind(win) : win[k];
  }
}

/* 캔버스 컨텍스트는 jsdom 에 없다. 아무것도 안 하는 스텁을 물린다.
   **null 을 주면 안 된다** — 렌더 함수가 통째로 건너뛰어져서, 정작 확인하고 싶은
   `drawTower` 같은 함수 안의 import 누락을 못 잡는다. 여기서 보는 건 그림이 아니라
   **이름이 다 잡히는가** 뿐이므로 호출만 삼키면 된다. */
const stubCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (k === 'canvas') return { width: 1200, height: 700 };
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
win.HTMLCanvasElement.prototype.getContext = () => stubCtx;

const fail = (msg, e) => {
  console.error('✗ ES 모듈 무결성 —', msg);
  if (e) {
    console.error('  ' + e.message);
    console.error('  ' + (String(e.stack).split('\n')[1] || '').trim());
  }
  console.error('  번들(dist)에서는 안 터지고 src/ 직접 로드에서만 터지는 종류다.');
  console.error('  import 를 빠뜨린 모듈이 없는지 볼 것 — RENDER.md §5.');
  process.exit(1);
};

try {
  /* main.js 는 부팅까지 한다. 엔트리를 통째로 평가해야 실제 로드 경로와 같아진다. */
  await import(pathToFileURL(join(ROOT, 'src/main.js')).href);
} catch (e) {
  fail('src/main.js 를 평가하다 죽었다', e);
}

if (!win.game) fail('window.game 이 안 생겼다 — 부팅이 중간에 멈췄다');

const need = ['S', 'newState', 'tickDay', 'draw', 'setMode', 'rand', 'setSeed'];
const miss = need.filter(k => win.game[k] === undefined);
if (miss.length) fail('debug 핸들에 빠진 것: ' + miss.join(', '));

/* 부팅만 봐서는 부족하다. 함수 **안에서만** 쓰는 이름의 import 누락은 그 함수를
   실제로 불러 봐야 터진다 — 렌더 코드가 특히 그렇다. 두 모드와 회전 네 방향,
   그리고 하루 진행까지 한 번씩 통과시킨다. */
const g = win.game;
try {
  g.setS(g.newState('무결성', 1));
  for (const m of ['city', 'store']) {
    g.setMode(m);
    for (let i = 0; i < 3; i++) g.draw();
  }
  g.setMode('city');
  for (let v = 0; v < 4; v++) { g.S.view = v; g.draw(); }
  g.S.view = 0;
  for (let i = 0; i < 40; i++) g.tickDay();
  g.draw();
} catch (e) {
  fail('렌더·진행 경로에서 죽었다', e);
}

/* UI 쪽도 훑는다. 다만 여기서는 **ReferenceError 만** 실패로 본다 —
   창을 맥락 없이 열면 다른 예외는 얼마든지 날 수 있고, 그걸 게이트로 삼으면
   검사가 흔들린다. 우리가 찾는 건 'import 를 빠뜨렸다' 하나뿐이다. */
let swept = 0;
for (const call of [
  () => ['co', 'staff', 'stock', 'bank', 'shop', 'shaman', 'rumor'].forEach(t => g.setTab(t)),
  () => g.setTab(null),
  () => g.openCompany(g.S.market[0]),
  () => g.closeModal(),
  () => g.openDesk(),
  () => g.closeModal(),
  () => g.openSettings(),
  () => g.closeModal(),
  () => g.renderAll(),
  () => g.rotateCity(1),
  () => g.zoomBy(1),
]) {
  try { call(); swept++; } catch (e) {
    if (e instanceof ReferenceError) fail('UI 경로에서 이름을 못 찾았다', e);
  }
}

console.log(`✓ ES 모듈 무결성 — src/ 를 그대로 로드해도 이름이 다 잡힌다`);
console.log(`  (${Object.keys(g).length}개 노출 · 두 모드 · 회전 4방향 · 40일 진행 · UI ${swept}경로 통과)`);
process.exit(0);
