import { BAL } from '../core/balance.js';
import { DIFFS, SECTORS, TIERS, gradeOf } from '../core/data.js';
import { sfx } from '../core/audio.js';
import { S } from '../core/state.js';
import { $, clamp, vpick, vrint, won } from '../core/util.js';
import { HH, HW, isoX, isoY } from './iso.js';
import { beginRotate, cityHit, drawCity, rotating } from './city.js';
import { drawStore, spawnCustomers, storeHit } from './store.js';
import { openCompany } from '../ui/companyPopup.js';
import { openDesk } from '../ui/desk.js';
import { setTab } from '../ui/tabs.js';
import { renderTopBar } from '../ui/index.js';

/* ══════════════════════════════════════════════════════════════
   CANVAS — 쿼터뷰 도시(M&A) / 쿼터뷰 매장·사무실(경영).
   외부 에셋 0, 전부 절차적 도트.

   렌더 파이프라인이 두 층으로 나뉜다.
     ① 월드 층 — 정수 배율 변환(PX) 위에 도트를 찍는다. 한 월드 픽셀이
        정확히 PX개의 디바이스 픽셀이 되므로 도트가 뭉개지지 않는다.
     ② 텍스트 층 — 변환 밖, 디바이스 해상도 그대로 그린다. 픽셀 폰트를
        확대하면 글자가 깨지므로 글자만 원래 크기로 따로 얹는다.
   자세한 규칙은 RENDER.md.
   ══════════════════════════════════════════════════════════════ */
const CV = document.getElementById('cv');

const X = CV.getContext('2d');

/* 도시 — blockPitch(4)칸 격자에서 2×2 자리가 한 블록, 나머지 2칸이 도로다.
   현재 8×8 = 64블록 / 32×32 타일 / 월드 1536×824.

   **배율은 카메라가 쥔다 (`camera.js`).** 기본이 1x 이고 휠로 3x 까지 간다.
   1x 에서 1080p 캔버스(약 1904×828)에 세로가 딱 들어가도록 여백을 잡아 뒀다.
   여기를 키우면 1x 전체 보기가 깨진다 — 늘릴 거면 CITY_HEAD 부터 다시 계산할 것. */
const MAP_W = BAL.cityBlocks * BAL.blockPitch, MAP_H = BAL.cityBlocks * BAL.blockPitch;
const CITY_HEAD = 56;                              // 위쪽 헤드룸 — 첫 블록의 고층이 잘리지 않을 만큼
const CITY_W = (MAP_W + MAP_H) * HW;
const CITY_H = CITY_HEAD + (MAP_W + MAP_H - 2) * HH + 24;  // + 24 = 맨 앞 상호판 자리
const CITY_O = { x: MAP_H * HW, y: CITY_HEAD };

/* 월드 밖 여백에도 시골 풍경을 깐다. 월드 변환은 캔버스를 자르지 않으므로,
   지면 레이어를 월드보다 크게 구워 음수 좌표에 붙이면 레터박스가 채워진다.
   월드 크기(=배율 계산의 분모)는 그대로라 좁은 창에서 배율이 떨어지지 않는다. */
const CITY_PAD_X = 546, CITY_PAD_Y = 60;

/* 사옥(경영) — 16×10 타일. gx 0..8 매장 / 9 칸막이 / 10..15 사무실 */
const ROOM_W = 16, ROOM_H_MAX = 17;

/**
 * 지금 쓰는 방 깊이. **등급**마다 남쪽으로 늘어난다 (core/data.js STORE_GRADE).
 *
 * **월드 사각형과 좌표 원점은 최대치로 고정이다.** 방이 커질 때 원점까지
 * 움직이면 카메라·바닥 캐시·클릭 판정이 전부 따라 흔들린다. 자리를 미리
 * 잡아 두고 **그리고 걸을 수 있는 범위만** 넓히면 그 위험이 사라진다.
 */
const roomH = () => 9 + (S.co ? gradeOf(S).depth : 0);
/* 사옥은 PX=2 로 돈다. 세로가 병목이라 여백을 깎아 404 로 맞췄다 —
   PX=2 에 필요한 캔버스 높이가 808px 이라 1080p(약 865px)에 여유가 남는다.
   여기를 40px 만 키워도 배율이 1로 떨어져 화면이 절반이 된다. */
/* 월드 사각형은 **지금 방 크기에 딱 맞춘다.** 최대 확장에 맞춰 고정해 두면
   확장하지 않은 초반부터 화면이 축소돼 보인다 (실제로 그렇게 만들었다가
   되돌렸다). 원점도 방 깊이를 따라가므로 세 값이 늘 한 몸이다. */
const storeO = () => ({ x: roomH() * HW, y: 72 });
const storeW = () => roomH() * HW + 384;
/* 예전에는 이 값이 428 을 넘지 못했다 — 월드 높이가 캔버스 절반(432)을 넘는
   순간 정수 배율이 2 에서 1 로 떨어져 화면이 통째로 반쪽이 됐기 때문이다.
   그 절벽 때문에 매장이 13줄에 묶여 있었다.
   이제 **배율을 2 아래로 내리지 않고 카메라가 잡는다**(applyCamera). 화면보다
   커지면 도시처럼 끌어서 본다 — 크기는 더 이상 화면 높이에 묶이지 않는다. */
const storeH = () => 392 + (roomH() - 10) * HH;
const footY  = () => storeH() - 24;                // 하단 상태 스트립 상단


const SPLIT_GX = 9;                                // 매장과 사무실을 가르는 열

/* Galmuri 는 비트맵 폰트라 설계 크기(9→10px, 11→12px, 14→15px)에서만 또렷하다.
   그 사이 값을 쓰면 글자가 흐려진다. 그래서 세 단만 쓴다. */
const FONT = {
  10: '"Galmuri9","Malgun Gothic",sans-serif',
  12: '"Galmuri11","Malgun Gothic",sans-serif',
  15: '"Galmuri14","Malgun Gothic",sans-serif',
};

const OUT = '#40384F';                             // 스프라이트 아웃라인 — 파스텔 바닥에서도 실루엣이 남는 진하기
const HAIRS = ['#2C2418', '#4A3728', '#1A1A22', '#6B4A2E', '#8A6A4A', '#5C3A5A'];
const SHIRTS = ['#4A86C7', '#D0453B', '#2FA37A', '#8B5CB8', '#F2B233', '#E8E4D8', '#C96A9B', '#5FA8D3'];
const SKINS = ['#F0D9B5', '#E8C39E', '#C98A64', '#D4A574'];

let hoverId = null, customers = [], pops = [], frame = 0;
let DPR = 1, PX = 1, OX = 0, OY = 0;               // 디바이스 배율 / 월드 정수 배율 / 원점

/* ── 카메라 ──────────────────────────────────────────────────
   맵이 화면보다 커질 수 있으므로 이동(드래그)과 확대(휠)를 준다.

   **배율은 정수만 쓴다.** 분수 배율이면 어떤 월드 픽셀은 2칸, 어떤 픽셀은 3칸을
   차지해서 도트가 울렁거린다 (RENDER.md §3). 그래서 휠은 1x → 2x → 3x 로 끊어 간다.
   `cam` 은 화면 한가운데에 오는 월드 좌표다.

   사옥은 카메라가 없다 — 방 하나가 통째로 들어오는 고정 배치가 읽기 쉽다. */
const ZOOM_MIN = 1, ZOOM_MAX = 3;
let zoom = 1, camX = 0, camY = 0, camFor = null, fitPX = 1;
let drag = null, dragged = false;

function initCanvas() {
  window.addEventListener('resize', fitCanvas);
  /* 최초 fitCanvas 가 레이아웃이 잡히기 전에 돌면 래퍼보다 큰 캔버스가 그대로 굳는다.
     실제로 백킹이 래퍼보다 150px 컸고, 모드를 한 번 바꿔야 제자리로 왔다.
     크기가 실제로 바뀔 때마다 다시 잡는 게 유일한 확실한 방법이다. */
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(fitCanvas).observe(document.getElementById('canvas-wrap'));
  }
  CV.addEventListener('mousemove', onCanvasMove);
  CV.addEventListener('mouseleave', () => { hoverId = null; hideTip(); });
  CV.addEventListener('click', onCanvasClick);
  CV.addEventListener('mousedown', onDragStart);
  CV.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function setMode(m) {
  if (m === 'store' && S.co.tier < 0) return;
  S.mode = m;
  fitCanvas();
  hoverId = null; hideTip();
  if (m === 'store' && !customers.length) spawnCustomers();
  renderTopBar();
}

function worldW() { return S && S.mode === 'store' ? storeW() : CITY_W; }

function worldH() { return S && S.mode === 'store' ? storeH() : CITY_H; }

/* 캔버스 백킹스토어를 래퍼 크기에 맞춘다. 월드는 그 안에서 정수 배율로 키운다.

   **CSS 크기는 여기서 건드리지 않는다.** 스타일시트가 100% 로 쥐고 있는데
   여기서 px 를 박으면, 레이아웃이 잡히기 전에 잰 값이 그대로 굳어 래퍼보다 큰
   캔버스가 남는다. 모드를 바꿔야 제자리로 오던 버그의 원인이 이것이었다. */
function fitCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw <= 0 || ch <= 0) return;
  DPR = clamp(Math.round(window.devicePixelRatio || 1), 1, 3);
  const bw = Math.round(cw * DPR), bh = Math.round(ch * DPR);
  if (CV.width !== bw || CV.height !== bh) { CV.width = bw; CV.height = bh; }
  applyCamera();
}

/** 배율과 원점을 다시 계산한다. 카메라를 움직인 뒤에도 부른다. */
function applyCamera() {
  const w = worldW(), h = worldH();
  fitPX = Math.max(1, Math.floor(Math.min(CV.width / w, CV.height / h)));
  if (!S || S.mode !== 'city') {                  // 사옥
    /* **배율을 2 아래로 내리지 않는다.** 화면에 통째로 맞추려고 fitPX 를 쓰면,
       매장이 조금만 커져도 정수 배율이 2→1 로 떨어져 그림이 반쪽이 된다.
       안 들어가면 줄이는 대신 **카메라가 잡는다** — 도시와 같은 방식이다. */
    PX = Math.max(2, fitPX);
    const vw = CV.width / PX, vh = CV.height / PX;
    if (camFor !== S) { camFor = S; camX = w / 2; camY = h / 2; }
    camX = vw >= w ? w / 2 : clamp(camX, vw / 2, w - vw / 2);
    camY = vh >= h ? h / 2 : clamp(camY, vh / 2, h - vh / 2);
    OX = Math.round(CV.width / 2 - camX * PX);
    // 다 들어갈 때는 살짝 위로 — 아래는 상호판이라 덜 비어 보인다
    if (vh >= h) OY = Math.floor((CV.height - h * PX) * 0.34);
    else OY = Math.round(CV.height / 2 - camY * PX);
    return;
  }
  applyCameraCity(w, h);
}

/* 맵이 화면보다 작으면 가운데 고정, 크면 가장자리 밖으로 못 나가게 잡는다.
   여유는 지면 레이어가 구워진 만큼(CITY_PAD)만 허용한다 — 그 밖은 검은 화면이다. */

/**
 * 지금 화면에 맞는 배율. **환경에서 유도한다 — 기준 해상도를 박아 두지 않는다.**
 *
 * 정수 배율만 쓰므로(RENDER.md §3) 1x 다음이 곧바로 2x 다. 그래서 예전에는
 * 화면이 아무리 커져도 1x 에 머물렀고, 2560 급에서는 월드(1536×824)가 캔버스
 * 가로의 54% 만 덮어 **도시가 빈 벌판 위의 섬처럼 보였다.** CSS 는 좁은 쪽으로만
 * 브레이크포인트가 있고 넓은 쪽이 비어 있던 것과 같은 구멍이다.
 *
 * **축소 한계**를 여기서 정한다. 초기 배율만 맞춰 놓으면 휠로 한 단 줄이는
 * 순간 그대로 되돌아온다 — 시작값 조정은 반응형이 아니다. 그래서 이 값이
 * `ZOOM_MIN` 을 대신한다. 도시는 원래 화면보다 크고 끌어서 보는 물건이라
 * (1920 화면에서도 이미 세로가 잘린 채 돈다) 이게 원래 값에 가깝다.
 *
 * 두 값의 작은 쪽을 목표 배율로 삼는다.
 * - `cover` 화면을 덮는 데 필요한 배율. 반올림이라 조금 남는 정도(1920 화면의
 *   가로 19%)는 그냥 두고, 절반 가까이 빌 때만 한 단 올라간다.
 * - `keep`  세로를 절반 미만으로 잘라먹지 않는 상한. 초광폭 화면에서 `cover`
 *   만 보면 맵이 띠처럼 잘린다. 여기서는 덮는 것보다 맵을 읽는 게 먼저다.
 *
 * 돌려주는 값은 **절대 배율이 아니라 `fitPX` 에 곱할 배수**다. 이걸 헷갈려
 * 절대값을 그대로 넘겼더니 3840×1900 에서 PX 가 6까지 튀어 맵의 40% 만 보였다.
 * 목표에 못 미치더라도 내림한다 — 넘치면 화면 밖으로 나가는 쪽이라 더 나쁘다.
 */
function coverZoom() {
  const cover = Math.round(Math.max(CV.width / CITY_W, CV.height / CITY_H));
  const keep = Math.floor(CV.height / (CITY_H * 0.5));
  const target = Math.max(1, Math.min(cover, keep));
  return Math.max(1, Math.floor(target / fitPX));
}

/* 휠이 오갈 수 있는 범위. 바닥은 화면이 정하고, 천장은 바닥에서 두 단 위다 —
   큰 화면이라고 확대 여유까지 줄어들면 안 된다. */
let zMin = ZOOM_MIN, zMax = ZOOM_MAX;

function applyCameraCity(w, h) {
  zMin = coverZoom();
  zMax = Math.max(ZOOM_MAX, zMin + 2);
  if (camFor !== S) { camFor = S; zoom = zMin; camX = w / 2; camY = h / 2; }
  zoom = clamp(zoom, zMin, zMax);            // 창이 커지면 바닥이 올라간다
  PX = fitPX * zoom;
  clampCam();
  OX = Math.round(CV.width / 2 - camX * PX);
  OY = Math.round(CV.height / 2 - camY * PX);
}
function spanClamp(v, half, size, pad) {
  if (half >= size / 2 + pad) return size / 2;
  return clamp(v, half - pad, size - half + pad);
}

function clampCam() {
  camX = spanClamp(camX, CV.width / 2 / PX, CITY_W, CITY_PAD_X * 0.6);
  camY = spanClamp(camY, CV.height / 2 / PX, CITY_H, CITY_PAD_Y * 0.6);
}

/** 휠 확대·축소. 포인터 밑에 있던 월드 좌표가 제자리에 남도록 카메라를 옮긴다. */
function zoomBy(dir, ev) {
  if (!S || S.mode !== 'city') return;
  const next = clamp(zoom + dir, zMin, zMax);
  if (next === zoom) return;
  const before = ev ? toLogical(ev) : null;
  zoom = next;
  applyCamera();
  if (before) {
    const after = toLogical(ev);
    camX += before.x - after.x; camY += before.y - after.y;
    applyCamera();
  }
  hideTip();
}

function onWheel(ev) {
  if (!S || S.mode !== 'city') return;
  ev.preventDefault();
  zoomBy(ev.deltaY < 0 ? 1 : -1, ev);
}

/* 드래그와 클릭을 가른다. 4 CSS 픽셀을 넘게 움직이면 그 뒤의 click 이벤트는 버린다 —
   안 그러면 맵을 끌 때마다 회사 창이 열린다. */
function onDragStart(ev) {
  /* 사옥에서도 끌 수 있다 — 매장이 화면보다 커질 수 있게 되면서 필요해졌다 */
  if (!S || ev.button !== 0) return;
  drag = { x: ev.clientX, y: ev.clientY, camX, camY, moved: false };
  dragged = false;
}

function onDragMove(ev) {
  if (!drag) return;
  const r = CV.getBoundingClientRect();
  if (!r.width) return;
  const k = CV.width / r.width / PX;               // CSS 픽셀 → 월드 픽셀
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; CV.style.cursor = 'grabbing'; hideTip(); }
  if (!drag.moved) return;
  camX = drag.camX - dx * k; camY = drag.camY - dy * (CV.height / r.height / PX);
  applyCamera();
}

function onDragEnd() {
  if (!drag) return;
  dragged = drag.moved;
  drag = null;
  CV.style.cursor = 'default';
}

/* ── 좌표 변환 ───────────────────────────────────────────── */
function toLogical(ev) {
  const r = CV.getBoundingClientRect();
  if (!r.width || !r.height) return { x: -1, y: -1 };
  const sx = CV.width / r.width, sy = CV.height / r.height;
  return { x: ((ev.clientX - r.left) * sx - OX) / PX, y: ((ev.clientY - r.top) * sy - OY) / PX };
}

/** 블록(2×2 타일) 바닥 마름모의 중심 */
function lotPos(lot) {
  return { x: isoX(CITY_O, lot.tx + 1, lot.ty + 1), y: isoY(CITY_O, lot.tx + 1, lot.ty + 1) };
}

function hitLot(p) {
  if (S.mode !== 'city') return null;
  return cityHit(p);
}

function onCanvasMove(ev) {
  if (rotating()) return hideTip();               // 도는 중에는 툴팁을 붙잡지 않는다
  if (drag && drag.moved) return;                 // 끄는 중에는 호버를 잡지 않는다
  if (S.mode === 'store') {                       // 사옥 — 핫스팟만 안내한다
    const sh = storeHit(toLogical(ev));
    CV.style.cursor = sh ? 'pointer' : 'default';
    if (!sh) { hoverId = null; return hideTip(); }
    if (sh.k !== hoverId) { hoverId = sh.k; showTip(ev, `<b class="c-gold">${sh.tip}</b>`); }
    return moveTip(ev);
  }
  const h = hitLot(toLogical(ev));
  CV.style.cursor = h ? 'pointer' : 'default';
  const id = h ? (h.self ? '__me' : h.co.id) : null;
  if (id === hoverId) { if (id) moveTip(ev); return; }
  hoverId = id;
  if (!id) return hideTip();
  showTip(ev, h.self
    ? `<b class="c-gold">${S.co.name}</b><br>${TIERS[S.co.tier].name} · 시총 ${won(S.co.cap)}<br><span class="c-dim">클릭 → 사옥 들어가기</span>`
    : h.co.owned
      ? `<b>${h.co.name}</b> <span class="c-jade">계열사</span><br>${SECTORS[h.co.sector].name} · 시총 ${won(h.co.cap)}`
      : `<b>${h.co.name}</b><br>${SECTORS[h.co.sector].name} · 시총 ${won(h.co.cap)}<br>인수 난이도 <b>${DIFFS[h.co.diff].name}</b>${h.co.listed ? ' · 상장' : ' · 비상장'}${h.co.curse ? '<br><span class="c-mauve">살(煞) 적중 중</span>' : ''}`);
  moveTip(ev);
}

function onCanvasClick(ev) {
  if (rotating()) return;
  if (dragged) { dragged = false; return; }       // 맵을 끈 것이지 누른 게 아니다
  if (S.mode === 'store') {
    const sh = storeHit(toLogical(ev));
    if (sh) { sfx('tap'); sh.k === 'boss' ? openDesk() : setTab('shop'); }
    return;
  }
  const h = hitLot(toLogical(ev));
  if (!h) return;
  if (h.self) return zoomInto('store');
  openCompany(h.co);
}

function zoomInto(m) {
  CV.classList.add('zooming');
  setTimeout(() => { setMode(m); CV.classList.remove('zooming'); }, 260);
}

/* ── 카메라 회전 ─────────────────────────────────────────────
   화면을 어둡게 덮고 그 사이에 방향을 바꾸던 걸 걷어냈다. 연출은 city.js 가
   쥔다 — 타일 좌표를 실수로 돌려 맵이 실제로 도는 전환을 그린다. */
function rotateCity(dir) {
  if (!S || S.mode !== 'city') return;
  beginRotate(dir);
  hideTip();
}

/* ── 툴팁 ────────────────────────────────────────────────── */
let tipEl = null;

function showTip(ev, html) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.id = 'canvas-tip';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html; tipEl.style.display = 'block';
}

function moveTip(ev) { if (tipEl) { tipEl.style.left = (ev.clientX + 16) + 'px'; tipEl.style.top = (ev.clientY + 16) + 'px'; } }

function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

/* ── 메인 드로우 ─────────────────────────────────────────── */
function draw() {
  frame++;
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.imageSmoothingEnabled = false;
  X.fillStyle = S.mode === 'city' ? '#8FBE8C' : '#9BA2B4';   // 여백도 배경과 같은 색
  X.fillRect(0, 0, CV.width, CV.height);
  X.setTransform(PX, 0, 0, PX, OX, OY);
  S.mode === 'city' ? drawCity() : drawStore();
  X.setTransform(1, 0, 0, 1, 0, 0);
}

/* 월드 좌표를 받아 글자를 디바이스 해상도로 찍는다. 변환 밖에서 그리므로
   맵을 몇 배로 키워도 글자는 항상 또렷하다. */
function drawText(wx, wy, str, o = {}) {
  const size = o.size || 10;
  X.save();
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.font = `${size * DPR}px ${FONT[size]}`;
  X.textAlign = o.align || 'center';
  X.textBaseline = o.baseline || 'alphabetic';
  const x = Math.round(OX + wx * PX), y = Math.round(OY + wy * PX);
  if (o.shadow !== false) { X.fillStyle = o.shadow || 'rgba(11,15,27,.85)'; X.fillText(str, x + DPR, y + DPR); }
  X.fillStyle = o.color || '#F5EFDD';
  X.fillText(str, x, y);
  X.restore();
}

/** 글자 폭을 월드 단위로 잰다. 라벨 배경 상자를 월드 층에 그리기 위한 것. */
function textW(str, size = 10) {
  X.save();
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.font = `${size * DPR}px ${FONT[size]}`;
  const w = X.measureText(str).width;
  X.restore();
  return w / PX;
}

/* 배경 상자는 월드 층, 글자는 텍스트 층. 두 층의 크기를 맞추려고 폭을 재서 쓴다. */
/* 상자 크기는 글자에서 뽑는다. 글자는 텍스트 층이라 월드를 키워도 같이 안 커지므로
   여기 숫자를 월드와 함께 1.5배 하면 상자만 헐거워진다. */
function drawLabel(x, y, str, color, size = 10) {
  const w = Math.max(20, Math.round(textW(str, size)) + 10), h = size + 6;
  X.fillStyle = 'rgba(11,15,27,.85)'; X.fillRect(Math.round(x - w / 2), Math.round(y - h), w, h);
  X.fillStyle = color; X.fillRect(Math.round(x - w / 2), Math.round(y - h), w, 2);
  drawText(x, y - 5, str, { size, color, shadow: false });
}

/* ── 캐릭터 ──────────────────────────────────────────────────
   카이로소프트 톤: 머리를 몸통만큼 크게, 전체를 어두운 선으로 감싸고,
   눈·머리 모양으로 방향을 준다. 걷기는 4프레임(모음–벌림–모음–반대벌림).

   걷기 위상은 반드시 **이동 거리**로 뽑는다. 프레임 수나 좌표로 뽑으면
   소수점 위치가 매 프레임 흔들려 발이 떨리는 것처럼 보인다.
   ─────────────────────────────────────────────────────────── */

/* 사람 한 명의 색. **연출 스트림을 쓴다** — 사옥을 한 번 더 열었다는 이유로
   그날의 인수 판정이 달라지면 시드 고정이 무의미해진다 (core/rng.js). */
function newLook(shirt) {
  return {
    skin: vpick(SKINS), shirt: shirt || vpick(SHIRTS), hair: vpick(HAIRS),
    pants: vpick(['#3A4258', '#4A3F55', '#2F3B4E', '#5A4A3A']),
    style: vrint(0, 3),
  };
}

/* 모서리 한 픽셀을 깎은 사각형. 카이로소프트 톤의 둥근 실루엣이 전부 여기서 나온다 —
   각진 fillRect 를 그대로 쌓으면 사람이 아니라 상자로 보인다. */
function rrect(x, y, w, h, color) {
  X.fillStyle = color;
  X.fillRect(x + 1, y, w - 2, h);
  X.fillRect(x, y + 1, w, h - 2);
}

/** 화면상 이동 방향으로 얼굴 방향을 정한다. */
function faceOf(vx, vy, fallback) {
  if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) return fallback || 's';
  return Math.abs(vy) >= Math.abs(vx) ? (vy > 0 ? 's' : 'n') : (vx > 0 ? 'e' : 'w');
}

/**
 * 사람 한 명. 발밑이 (x, y) 다.
 * @param dir  's'(앞) 'n'(뒤) 'e'(우) 'w'(좌)
 * @param step 걷기 위상(정수). 서 있으면 1을 넘긴다.
 */
function drawPerson(x, y, look, dir = 's', step = 1) {
  x = Math.round(x); y = Math.round(y);
  const f = ((step % 4) + 4) % 4;
  const sw = f === 1 ? 1 : f === 3 ? -1 : 0;       // 다리 벌어짐
  const b = y + (f % 2 === 0 ? -1 : 0);            // 모을 때 몸이 살짝 뜬다

  X.fillStyle = 'rgba(0,0,0,.17)';                 // 발밑 그림자
  X.fillRect(x - 8, y - 1, 18, 4); X.fillRect(x - 6, y - 2, 14, 6);

  drawLegs(x, b, look, sw);
  drawTorso(x, b, look.skin, look.shirt, -sw);
  drawHead(x, b, look.skin, look.hair, dir, look.style | 0);
}

/**
 * 도시용 축소 보행자 — 높이 16px.
 *
 * 도시 건물이 33~99px 인데 사무실용 28px 인물을 그대로 쓰면 **사람이 3층 건물만
 * 해진다.** 이게 "NPC 가 어색하다"의 가장 큰 원인이었다.
 *
 * 0.5배 변환으로 줄이지 않고 따로 그린다. 월드 캔버스가 672×384 라 변환 축소는
 * 1px 선을 반픽셀로 만들어 뭉갠다 — 도트 그림에서는 치명적이다.
 */
function drawPed(x, y, look, dir = 's', step = 1) {
  x = Math.round(x); y = Math.round(y);
  const f = ((step % 4) + 4) % 4;
  const sw = f === 1 ? 1 : f === 3 ? -1 : 0;       // 다리 벌어짐
  const b = y + (f % 2 === 0 ? -1 : 0);
  const back = dir === 'n';

  X.fillStyle = 'rgba(0,0,0,.20)';                 // 발밑 그림자
  X.fillRect(x - 4, y - 1, 9, 3); X.fillRect(x - 3, y - 2, 7, 5);

  for (const s of [-1, 1]) {                       // 다리
    const lx = (s < 0 ? x - 3 : x + 1) + s * sw;
    X.fillStyle = OUT; X.fillRect(lx - 1, b - 6, 4, 6);
    X.fillStyle = look.pants; X.fillRect(lx, b - 5, 2, 3);
    X.fillStyle = '#332E3E'; X.fillRect(lx, b - 2, 2, 2);
  }
  X.fillStyle = OUT; X.fillRect(x - 5, b - 11, 11, 7);          // 몸통 + 팔
  X.fillStyle = look.shirt; X.fillRect(x - 4, b - 10, 9, 5);
  X.fillStyle = shade(look.shirt, 0.22); X.fillRect(x - 4, b - 10, 9, 1);
  X.fillStyle = shade(look.shirt, -0.24); X.fillRect(x - 4, b - 6, 9, 1);
  X.fillStyle = look.skin; X.fillRect(x - 4, b - 7, 1, 2); X.fillRect(x + 4, b - 7, 1, 2);

  X.fillStyle = OUT; X.fillRect(x - 4, b - 17, 9, 7);           // 머리
  X.fillStyle = look.skin; X.fillRect(x - 3, b - 16, 7, 5);
  X.fillStyle = look.hair; X.fillRect(x - 3, b - 16, 7, back ? 5 : 2);
  if (!back) {                                                  // 눈 — 뒤돌면 안 그린다
    X.fillStyle = '#3B3546';
    const ex = dir === 'e' ? 1 : dir === 'w' ? -1 : 0;
    X.fillRect(x - 2 + ex, b - 13, 1, 2); X.fillRect(x + 2 + ex, b - 13, 1, 2);   // 머리 x-3~x+3 의 중심은 x
  }
}

/** 다리 — 바지 + 신발. 걸을 때 앞뒤로 벌어진다. */
function drawLegs(x, b, look, sw) {
  const shoe = '#332E3E';
  for (const s of [-1, 1]) {
    const lx = (s < 0 ? x - 7 : x) + s * sw;
    rrect(lx, b - 13, 7, 13, OUT);
    X.fillStyle = look.pants; X.fillRect(lx + 1, b - 12, 5, 8);
    X.fillStyle = shade(look.pants, -0.24); X.fillRect(lx + 1, b - 5, 5, 2);
    X.fillStyle = shoe; X.fillRect(lx + 1, b - 3, 5, 3);
    X.fillStyle = shade(shoe, 0.55); X.fillRect(lx + 1, b - 3, 5, 1);
  }
}

/** 몸통 + 팔. 선 모습과 앉은 모습이 공유한다. */
function drawTorso(x, b, skin, shirt, swing) {
  const t = b - 25;                                // 어깨선
  for (const s of [-1, 1]) {                       // 팔 — 몸통보다 먼저 그려 뒤로 보낸다
    const ax = s < 0 ? x - 12 : x + 9, dy = s * swing;
    rrect(ax, t + 2 + dy, 4, 11, OUT);
    X.fillStyle = shade(shirt, -0.28); X.fillRect(ax + 1, t + 3 + dy, 2, 6);
    X.fillStyle = skin; X.fillRect(ax + 1, t + 9 + dy, 2, 3);
  }
  rrect(x - 9, t, 19, 15, OUT);
  X.fillStyle = shirt; X.fillRect(x - 8, t + 1, 17, 13);
  X.fillStyle = shade(shirt, 0.20); X.fillRect(x - 8, t + 1, 17, 3);       // 어깨 하이라이트
  X.fillStyle = shade(shirt, -0.20); X.fillRect(x - 8, t + 11, 17, 3);     // 밑단 그늘
  X.fillStyle = shade(shirt, -0.36);                                       // 옷깃
  X.fillRect(x - 3, t + 1, 7, 2); X.fillRect(x - 2, t + 3, 5, 1); X.fillRect(x - 1, t + 4, 3, 1);
}

/** 큰 머리 + 방향별 얼굴 */
function drawHead(x, b, skin, hair, dir, style = 0) {
  const t = b - 44;                                // 정수리
  rrect(x - 10, t, 21, 20, OUT);
  X.fillStyle = skin; X.fillRect(x - 9, t + 1, 19, 18);
  X.fillStyle = shade(skin, 0.12); X.fillRect(x - 9, t + 1, 19, 2);
  X.fillStyle = shade(skin, -0.15); X.fillRect(x - 9, t + 16, 19, 3);      // 턱 그늘

  drawHair(x, t, hair, dir, style);
  if (dir === 'n') return;                         // 뒤통수 — 얼굴이 안 보인다

  /* 얼굴은 x-9 부터 19px 이라 중심이 x 다. 눈은 3px 폭이므로 좌우 여백이 같으려면
     -6(=x-6~x-4) 과 +4(=x+4~x+6) 여야 한다. 오른눈이 +3 이면 한 칸씩 왼쪽으로
     쏠려 보이는데, 얼굴이 20px 밖에 안 돼 1px 이 그대로 눈에 띈다. */
  const eyes = dir === 's' ? [-6, 4] : dir === 'e' ? [4] : [-6];
  for (const ex of eyes) {
    X.fillStyle = '#332E3E'; X.fillRect(x + ex, t + 9, 3, 5);
    /* 반짝임은 **1×1** 이다. 예전엔 눈 왼쪽에 1×2 로 세워 넣었는데, 3px 짜리
       눈에서 왼쪽 한 줄이 하얘지면 남는 어두운 부분이 오른쪽으로 몰려
       **눈동자가 오른쪽을 보는 것처럼** 읽힌다. 좌우 대칭이어도 그렇다. */
    X.fillStyle = 'rgba(255,255,255,.55)'; X.fillRect(x + ex, t + 9, 1, 1);
  }
  X.fillStyle = 'rgba(232,138,138,.30)';           // 볼
  if (dir !== 'w') X.fillRect(x + 5, t + 13, 4, 2);
  if (dir !== 'e') X.fillRect(x - 8, t + 13, 4, 2);
  X.fillStyle = shade(skin, -0.34);                // 입
  X.fillRect(x + (dir === 'e' ? 2 : dir === 'w' ? -4 : -1), t + 15, 3, 1);
}

/* 머리 모양 넷 — 짧은 머리 / 가르마 / 단발 / 넘긴 머리.
   NPC 가 화면에 수십 명 서 있으므로 실루엣이 갈려야 서로 달라 보인다. */
function drawHair(x, t, hair, dir, style) {
  X.fillStyle = hair;
  if (dir === 'n') {                               // 뒤통수는 머리로 꽉 찬다
    X.fillRect(x - 9, t + 1, 19, 15);
    X.fillStyle = shade(hair, 0.26); X.fillRect(x - 9, t + 1, 19, 2);
    return;
  }
  X.fillRect(x - 9, t + 1, 19, 5);                                          // 앞머리
  X.fillRect(x - 9, t + 1, 3, 9); X.fillRect(x + 7, t + 1, 3, 9);           // 옆머리
  if (style === 1) X.fillRect(x - 9, t + 1, 9, 8);                          // 가르마
  if (style === 2) { X.fillRect(x - 9, t + 1, 3, 17); X.fillRect(x + 7, t + 1, 3, 17); }  // 단발
  if (style === 3) X.fillRect(x - 9, t + 1, 19, 3);                         // 넘긴 머리 — 이마가 넓다
  X.fillStyle = shade(hair, 0.26); X.fillRect(x - 8, t + 1, 17, 2);
  if (style === 3) { X.fillStyle = shade(hair, -0.24); X.fillRect(x - 9, t + 4, 19, 1); }
}

/** 의자에 앉은 모습 — 하반신은 책상에 가리므로 상반신만 그린다. */
function drawSitter(x, y, look, dir = 's', busy = 0) {
  x = Math.round(x); y = Math.round(y);
  const b = y + (busy ? -1 : 0);
  X.fillStyle = 'rgba(0,0,0,.17)'; X.fillRect(x - 8, y - 1, 18, 4);
  rrect(x - 11, b - 16, 23, 16, OUT);              // 의자 등받이
  X.fillStyle = '#4C5673'; X.fillRect(x - 10, b - 15, 21, 14);
  X.fillStyle = '#5E6A88'; X.fillRect(x - 10, b - 15, 21, 3);
  drawTorso(x, b, look.skin, look.shirt, busy ? 1 : 0);
  drawHead(x, b, look.skin, look.hair, dir, look.style | 0);
}

/* ── 말풍선 ──────────────────────────────────────────────────
   참조한 카이로 화면에서 사람이 살아 있게 보이는 이유의 절반은 도트 품질이
   아니라 **말풍선**이다. 도형 인간이라도 말을 걸면 사람으로 읽힌다.
   스프라이트를 못 찍는 조건에서 가장 값싼 생동감이다.

   글자는 월드 좌표에 그리면 배율에 눌려 뭉개지므로, 상자만 월드에 그리고
   글자는 `drawText` 의 화면 좌표 경로를 그대로 탄다. */
function drawBubble(x, y, txt, tint = '#FFF8E6') {
  /* size 는 10/12/15 만 있다. 9 는 FONT 테이블에 없어 `X.font` 대입이 무시되고
     Galmuri 가 아니라 시스템 기본 글꼴로 떨어졌다 (RENDER.md §1). */
  const w = Math.max(20, Math.round(textW(txt, 10)) + 10), h = 15;
  const bx = Math.round(x - w / 2), by = Math.round(y - h);
  X.fillStyle = 'rgba(0,0,0,.18)';
  X.fillRect(bx + 1, by + 2, w, h);
  rrect(bx, by, w, h, '#3B3546');                   // 테두리
  rrect(bx + 1, by + 1, w - 2, h - 2, tint);
  X.fillStyle = '#3B3546';                          // 꼬리
  X.fillRect(Math.round(x) - 2, by + h - 1, 5, 2);
  X.fillRect(Math.round(x) - 1, by + h + 1, 3, 2);
  X.fillStyle = tint; X.fillRect(Math.round(x) - 1, by + h - 1, 3, 2);
  drawText(x, by + 11, txt, { size: 10, color: '#4A4356' });
}

/**
 * 지금 이 대상이 말풍선을 띄울 차례인가. 상태를 따로 들고 다니지 않으려고
 * 프레임과 씨드로만 정한다 — **연출은 게임 난수열을 건드리면 안 된다**
 * (core/rng.js 의 원칙: 그림이 판정을 밀면 안 된다).
 */
function bubbleTurn(seed, period = 520, span = 110) {
  return ((frame + seed * 97) % period) < span;
}

function drawPops() {
  pops = pops.filter(p => p.t-- > 0);
  for (const p of pops) {
    X.save();
    X.globalAlpha = clamp(p.t / 30, 0, 1);
    drawText(p.x, p.y - (46 - p.t) * 0.52, p.txt, { size: 10, color: p.c });
    X.restore();
  }
}

/** 두 색을 t 만큼 섞는다. 업종 색에서 건물 몸통 색을 뽑을 때 쓴다. */
function mix(a, b, t) {
  const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
  const f = (s, d) => Math.round(s + (d - s) * t);
  return `rgb(${f(p >> 16, q >> 16)},${f((p >> 8) & 255, (q >> 8) & 255)},${f(p & 255, q & 255)})`;
}

function shade(hex, amt) {
  if (hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = c => clamp(Math.round(c * (1 + amt)), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export { drawHair, drawLegs, rrect, applyCamera, zoomBy, CITY_HEAD, CITY_H, CITY_O, CITY_PAD_X, CITY_PAD_Y, CITY_W, CV, DPR, FONT, footY, HAIRS, MAP_H, MAP_W, OUT, OX, OY, PX, ROOM_H_MAX, ROOM_W, roomH, SHIRTS, SKINS, SPLIT_GX, storeH, storeO, storeW, X, customers, draw, drawHead, drawLabel, drawPed, drawPerson, drawBubble, bubbleTurn, drawPops, drawSitter, drawText, drawTorso, faceOf, fitCanvas, frame, hideTip, hitLot, hoverId, initCanvas, lotPos, mix, moveTip, newLook, onCanvasClick, onCanvasMove, pops, setMode, shade, showTip, textW, tipEl, toLogical, worldH, worldW, zoomInto, rotateCity };
