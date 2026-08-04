import { BAL } from '../core/balance.js';
import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { sfx } from '../core/audio.js';
import { S } from '../core/state.js';
import { $, clamp, pick, won } from '../core/util.js';
import { HW, isoX, isoY } from './iso.js';
import { cityHit, drawCity } from './city.js';
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

/* 도시 — 3칸 격자에서 2×2 자리가 한 블록. 타일 수 = cityBlocks × 3.
   현재 10×10 = 100블록 / 30×30 타일.

   **배율 정책이 바뀌었다 (GRAPHICS.md 2단계).** 타일이 48×24 라 월드가 1440×792 이고
   1080p 브라우저의 캔버스(약 1904×865)에서 PX=1 로 딱 맞는다. PX 는 1 이 하한이므로
   창이 줄어도 배율이 더 떨어질 곳이 없다 — 대신 좁은 화면에서는 가장자리가 잘린다.
   블록을 더 늘리려면 세로 예산(865px)부터 다시 짜야 한다. */
const MAP_W = BAL.cityBlocks * 3, MAP_H = BAL.cityBlocks * 3;
const CITY_HEAD = 60;                              // 위쪽 헤드룸 — 첫 블록의 고층이 잘리지 않을 만큼
const CITY_W = (MAP_W + MAP_H) * HW;
const CITY_H = CITY_HEAD + (MAP_W + MAP_H - 2) * HH + 36;  // + 36 = 맨 앞 상호판 자리
const CITY_O = { x: MAP_H * HW, y: CITY_HEAD };

/* 월드 밖 여백에도 시골 풍경을 깐다. 월드 변환은 캔버스를 자르지 않으므로,
   지면 레이어를 월드보다 크게 구워 음수 좌표에 붙이면 레터박스가 채워진다.
   월드 크기(=배율 계산의 분모)는 그대로라 좁은 창에서 배율이 떨어지지 않는다. */
const CITY_PAD_X = 546, CITY_PAD_Y = 60;

/* 사옥(경영) — 16×10 타일. gx 0..8 매장 / 9 칸막이 / 10..15 사무실 */
const ROOM_W = 16, ROOM_H = 10;
/* 사옥은 PX=2 로 돈다. 세로가 병목이라 여백을 깎아 404 로 맞췄다 —
   PX=2 에 필요한 캔버스 높이가 808px 이라 1080p(약 865px)에 여유가 남는다.
   여기를 40px 만 키워도 배율이 1로 떨어져 화면이 절반이 된다. */
const STORE_W = 624, STORE_H = 404;
const STORE_O = { x: ROOM_H * HW, y: 72 };
const FOOT_Y = STORE_H - 24;                       // 하단 상태 스트립 상단
const SPLIT_GX = 9;                                // 매장과 사무실을 가르는 열

/* Galmuri 는 비트맵 폰트라 설계 크기(9→10px, 11→12px, 14→15px)에서만 또렷하다.
   그 사이 값을 쓰면 글자가 흐려진다. 그래서 세 단만 쓴다. */
const FONT = {
  10: '"Galmuri9","Malgun Gothic",sans-serif',
  12: '"Galmuri11","Malgun Gothic",sans-serif',
  15: '"Galmuri14","Malgun Gothic",sans-serif',
};

const OUT = '#2A2233';                             // 스프라이트 아웃라인
const HAIRS = ['#2C2418', '#4A3728', '#1A1A22', '#6B4A2E', '#8A6A4A', '#5C3A5A'];
const SHIRTS = ['#4A86C7', '#D0453B', '#2FA37A', '#8B5CB8', '#F2B233', '#E8E4D8', '#C96A9B', '#5FA8D3'];
const SKINS = ['#F0D9B5', '#E8C39E', '#C98A64', '#D4A574'];

let hoverId = null, customers = [], pops = [], frame = 0;
let DPR = 1, PX = 1, OX = 0, OY = 0;               // 디바이스 배율 / 월드 정수 배율 / 원점

function initCanvas() {
  window.addEventListener('resize', fitCanvas);
  CV.addEventListener('mousemove', onCanvasMove);
  CV.addEventListener('mouseleave', () => { hoverId = null; hideTip(); });
  CV.addEventListener('click', onCanvasClick);
}

function setMode(m) {
  if (m === 'store' && S.co.tier < 0) return;
  S.mode = m;
  fitCanvas();
  hoverId = null; hideTip();
  if (m === 'store' && !customers.length) spawnCustomers();
  renderTopBar();
}

function worldW() { return S && S.mode === 'store' ? STORE_W : CITY_W; }

function worldH() { return S && S.mode === 'store' ? STORE_H : CITY_H; }

/* 캔버스를 래퍼 크기에 1:1로 맞추고, 월드는 그 안에서 정수 배율로 키운다.
   배율이 정수가 아니면 어떤 월드 픽셀은 2칸, 어떤 픽셀은 3칸을 차지해서
   도트가 울렁거린다. 남는 여백은 레터박스로 두고 배경색으로 채운다. */
function fitCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw <= 0 || ch <= 0) return;
  DPR = clamp(Math.round(window.devicePixelRatio || 1), 1, 3);
  CV.style.width = cw + 'px'; CV.style.height = ch + 'px';
  CV.width = cw * DPR; CV.height = ch * DPR;
  const w = worldW(), h = worldH();
  PX = Math.max(1, Math.floor(Math.min(CV.width / w, CV.height / h)));
  OX = Math.floor((CV.width - w * PX) / 2);
  OY = Math.floor((CV.height - h * PX) * 0.34);   // 살짝 위로 — 아래는 상호판이라 덜 비어 보인다
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
   2D 라 중간 각도를 그릴 수 없다. 회전 프레임을 보여 주려 하면 어색하므로
   zoomInto 와 같은 페이드로 한 번 덮고 그 사이에 방향을 바꾼다.
   지면 레이어는 city.js 가 bakedView 를 보고 알아서 다시 굽는다. */
function rotateCity(dir) {
  if (!S || S.mode !== 'city') return;
  CV.classList.add('zooming');
  setTimeout(() => {
    S.view = (((S.view | 0) + dir) % 4 + 4) % 4;
    hideTip();
    CV.classList.remove('zooming');
  }, 130);
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
  X.fillStyle = S.mode === 'city' ? '#25402F' : '#151928';   // 여백도 배경과 같은 색
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

/** 사람 한 명의 색을 뽑는다. */
function newLook(shirt) {
  return {
    skin: pick(SKINS), shirt: shirt || pick(SHIRTS), hair: pick(HAIRS),
    pants: pick(['#3A4258', '#4A3F55', '#2F3B4E', '#5A4A3A']),
  };
}

/** 화면상 이동 방향으로 얼굴 방향을 정한다. */
function faceOf(vx, vy, fallback) {
  if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) return fallback || 's';
  return Math.abs(vy) >= Math.abs(vx) ? (vy > 0 ? 's' : 'n') : (vx > 0 ? 'e' : 'w');
}

/**
 * @param dir  's'(앞) 'n'(뒤) 'e'(우) 'w'(좌)
 * @param step 걷기 위상(정수). 서 있으면 1을 넘긴다.
 */
function drawPerson(x, y, look, dir = 's', step = 1) {
  x = Math.round(x); y = Math.round(y);
  const f = ((step % 4) + 4) % 4;
  const sw = f === 1 ? 1 : f === 3 ? -1 : 0;       // 다리 벌어짐
  const b = y + (f % 2 === 0 ? -1 : 0);            // 모을 때 몸이 살짝 뜬다
  const { skin, shirt, hair, pants } = look;

  X.fillStyle = 'rgba(0,0,0,.22)';
  X.fillRect(x - 8, y, 17, 3); X.fillRect(x - 5, y - 2, 11, 2); X.fillRect(x - 5, y + 3, 11, 2);

  X.fillStyle = OUT;                                // 다리
  X.fillRect(x - 8 - sw, b - 11, 8, 11); X.fillRect(x + 2 + sw, b - 11, 8, 11);
  X.fillStyle = pants;
  X.fillRect(x - 6 - sw, b - 11, 5, 6); X.fillRect(x + 3 + sw, b - 11, 5, 6);
  X.fillStyle = '#20263A';
  X.fillRect(x - 6 - sw, b - 5, 5, 5); X.fillRect(x + 3 + sw, b - 5, 5, 5);

  drawTorso(x, b, skin, shirt, -sw);
  drawHead(x, b, skin, hair, dir);
}

/** 몸통 + 팔. 선 모습과 앉은 모습이 공유한다. */
function drawTorso(x, b, skin, shirt, swing) {
  X.fillStyle = OUT; X.fillRect(x - 12, b - 24, 24, 17);
  X.fillStyle = shade(shirt, -0.30);
  X.fillRect(x - 11, b - 23, 3, 12 + swing); X.fillRect(x + 8, b - 23, 3, 12 - swing);
  X.fillStyle = skin;
  X.fillRect(x - 11, b - 12 + swing, 3, 3); X.fillRect(x + 8, b - 12 - swing, 3, 3);
  X.fillStyle = shirt; X.fillRect(x - 8, b - 23, 15, 15);
  X.fillStyle = shade(shirt, 0.22); X.fillRect(x - 8, b - 23, 15, 3);
  X.fillStyle = shade(shirt, -0.16); X.fillRect(x - 8, b - 11, 15, 3);
}

/** 큰 머리 + 방향별 얼굴 */
function drawHead(x, b, skin, hair, dir) {
  const t = b - 41;
  X.fillStyle = OUT; X.fillRect(x - 11, t, 21, 20);
  X.fillStyle = skin; X.fillRect(x - 9, t + 2, 18, 17);
  X.fillStyle = shade(skin, -0.16); X.fillRect(x - 9, t + 15, 18, 3);

  X.fillStyle = hair;
  if (dir === 'n') {                                // 뒤통수 — 얼굴이 안 보인다
    X.fillRect(x - 9, t + 2, 18, 15);
    X.fillStyle = shade(hair, 0.28); X.fillRect(x - 9, t + 2, 18, 3);
    return;
  }
  X.fillRect(x - 9, t + 2, 18, 6);
  X.fillRect(x - 9, t + 2, 3, 12); X.fillRect(x + 6, t + 2, 3, 12);
  if (dir === 'e') X.fillRect(x - 9, t + 2, 8, 11);
  if (dir === 'w') X.fillRect(x + 2, t + 2, 8, 11);
  X.fillStyle = shade(hair, 0.28); X.fillRect(x - 9, t + 2, 18, 2);

  X.fillStyle = '#20263A';
  if (dir === 's') { X.fillRect(x - 6, t + 9, 3, 5); X.fillRect(x + 3, t + 9, 3, 5); }
  if (dir === 'e') X.fillRect(x + 3, t + 9, 3, 5);
  if (dir === 'w') X.fillRect(x - 6, t + 9, 3, 5);
}

/** 의자에 앉은 모습 — 하반신은 책상에 가리므로 상반신만 그린다. */
function drawSitter(x, y, look, dir = 's', busy = 0) {
  x = Math.round(x); y = Math.round(y);
  const b = y + (busy ? -1 : 0);
  X.fillStyle = 'rgba(0,0,0,.20)'; X.fillRect(x - 9, y - 2, 20, 5);
  X.fillStyle = OUT; X.fillRect(x - 11, b - 14, 21, 14);
  X.fillStyle = '#3E4763'; X.fillRect(x - 9, b - 12, 18, 12);
  X.fillStyle = '#4C5673'; X.fillRect(x - 9, b - 12, 18, 3);
  drawTorso(x, b, look.skin, look.shirt, busy ? 1 : 0);
  drawHead(x, b, look.skin, look.hair, dir);
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

export { CITY_HEAD, CITY_H, CITY_O, CITY_PAD_X, CITY_PAD_Y, CITY_W, CV, DPR, FONT, FOOT_Y, HAIRS, MAP_H, MAP_W, OUT, OX, OY, PX, ROOM_H, ROOM_W, SHIRTS, SKINS, SPLIT_GX, STORE_H, STORE_O, STORE_W, X, customers, draw, drawHead, drawLabel, drawPerson, drawPops, drawSitter, drawText, drawTorso, faceOf, fitCanvas, frame, hideTip, hitLot, hoverId, initCanvas, lotPos, mix, moveTip, newLook, onCanvasClick, onCanvasMove, pops, setMode, shade, showTip, textW, tipEl, toLogical, worldH, worldW, zoomInto, rotateCity };
