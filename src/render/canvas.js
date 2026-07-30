import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, chance, clamp, pick, rint, rnd, won } from '../core/util.js';
import { drawCity } from './city.js';
import { drawStore, spawnCustomers } from './store.js';
import { openCompany } from '../ui/companyPopup.js';
import { renderTopBar } from '../ui/index.js';

/* ══════════════════════════════════════════════════════════════
   CANVAS — 도시 맵(M&A) / 매장 내부(경영). 에셋 없이 전부 절차적 픽셀.
   ══════════════════════════════════════════════════════════════ */
const CV = document.getElementById('cv');

const X = CV.getContext('2d');

const T = 32;                       // 타일 크기
const MAP_W = 19, MAP_H = 13;       // 도시 타일 수
const CITY_W = MAP_W * T, CITY_H = MAP_H * T;

const STORE_W = 320, STORE_H = 208;

let hoverId = null, cars = [], walkers = [], customers = [], pops = [], frame = 0;

function initCanvas() {
  for (let i = 0; i < 7; i++) cars.push({ t: Math.random(), lane: rint(0, 4), dir: chance(0.5) ? 1 : -1, c: pick(['#D0453B','#4A86C7','#F2B233','#E8E4D8','#2FA37A']) });
  for (let i = 0; i < 14; i++) walkers.push({ t: Math.random(), lane: rint(0, 4), axis: chance(0.5) ? 'h' : 'v', dir: chance(0.5) ? 1 : -1, c: pick(['#E8C39E','#C98A64','#F0D9B5']), s: rnd(0.00035, 0.0009) });
  window.addEventListener('resize', fitCanvas);
  CV.addEventListener('mousemove', onCanvasMove);
  CV.addEventListener('mouseleave', () => { hoverId = null; hideTip(); });
  CV.addEventListener('click', onCanvasClick);
}

function setMode(m) {
  if (m === 'store' && S.co.tier < 0) return;
  S.mode = m;
  CV.width  = m === 'city' ? CITY_W : STORE_W;
  CV.height = m === 'city' ? CITY_H : STORE_H;
  fitCanvas();
  hoverId = null; hideTip();
  if (m === 'store' && !customers.length) spawnCustomers();
  renderTopBar();
}

/* 화면을 꽉 채우되 종횡비를 유지한다. getBoundingClientRect와 실제 픽셀이
   1:1로 대응해야 클릭 판정이 어긋나지 않으므로 CSS 크기를 직접 계산한다. */
function fitCanvas() {
  const wrap = document.getElementById('canvas-wrap');
  const aw = wrap.clientWidth - 16, ah = wrap.clientHeight - 16;
  if (aw <= 0 || ah <= 0) return;
  const ar = CV.width / CV.height;
  let w = aw, h = w / ar;
  if (h > ah) { h = ah; w = h * ar; }
  CV.style.width = Math.floor(w) + 'px';
  CV.style.height = Math.floor(h) + 'px';
}

/* ── 좌표 변환 ───────────────────────────────────────────── */
function toLogical(ev) {
  const r = CV.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * CV.width, y: (ev.clientY - r.top) / r.height * CV.height };
}

function lotRect(lot) { return { x: lot.tx * T, y: lot.ty * T, w: T * 2, h: T * 2 }; }

function hitLot(p) {
  if (S.mode !== 'city') return null;
  const my = lotRect(S.co.lot);
  if (p.x >= my.x && p.x < my.x + my.w && p.y >= my.y - 16 && p.y < my.y + my.h) return { self: true };
  for (const c of S.market) {
    const r = lotRect(c.lot);
    if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) return { co: c };
  }
  return null;
}

function onCanvasMove(ev) {
  const h = hitLot(toLogical(ev));
  CV.style.cursor = h ? 'pointer' : 'default';
  const id = h ? (h.self ? '__me' : h.co.id) : null;
  if (id === hoverId) { if (id) moveTip(ev); return; }
  hoverId = id;
  if (!id) return hideTip();
  showTip(ev, h.self
    ? `<b class="c-gold">${S.co.name}</b><br>${TIERS[S.co.tier].name} · 시총 ${won(S.co.cap)}<br><span class="c-dim">클릭 → 경영 모드</span>`
    : h.co.owned
      ? `<b>${h.co.name}</b> <span class="c-jade">계열사</span><br>${SECTORS[h.co.sector].name} · 시총 ${won(h.co.cap)}`
      : `<b>${h.co.name}</b><br>${SECTORS[h.co.sector].name} · 시총 ${won(h.co.cap)}<br>인수 난이도 <b>${DIFFS[h.co.diff].name}</b>${h.co.listed ? ' · 상장' : ' · 비상장'}${h.co.curse ? '<br><span class="c-mauve">살(煞) 적중 중</span>' : ''}`);
  moveTip(ev);
}

function onCanvasClick(ev) {
  const h = hitLot(toLogical(ev));
  if (!h) return;
  if (h.self) return zoomInto('store');
  openCompany(h.co);
}

function zoomInto(m) {
  CV.classList.add('zooming');
  setTimeout(() => { setMode(m); CV.classList.remove('zooming'); }, 260);
}

/* ── 툴팁 ────────────────────────────────────────────────── */
let tipEl = null;

function showTip(ev, html) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.style.cssText = 'position:fixed;z-index:60;pointer-events:none;background:var(--ink);border:2px solid var(--gold);color:var(--paper);padding:6px 9px;font-size:10px;line-height:1.6;box-shadow:2px 2px 0 rgba(0,0,0,.6);max-width:230px';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html; tipEl.style.display = 'block';
}

function moveTip(ev) { if (tipEl) { tipEl.style.left = (ev.clientX + 14) + 'px'; tipEl.style.top = (ev.clientY + 14) + 'px'; } }

function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

/* ── 메인 드로우 ─────────────────────────────────────────── */
function draw() {
  frame++;
  X.imageSmoothingEnabled = false;
  S.mode === 'city' ? drawCity() : drawStore();
}

function drawLabel(x, y, text, color) {
  X.font = '8px "Galmuri9",monospace'; X.textAlign = 'center';
  const w = X.measureText(text).width + 8;
  X.fillStyle = '#161A2B'; X.fillRect(x - w / 2, y - 8, w, 11);
  X.fillStyle = color; X.strokeStyle = color; X.lineWidth = 1;
  X.strokeRect(x - w / 2, y - 8, w, 11);
  X.fillText(text, x, y);
  X.textAlign = 'left';
}

function drawPerson(x, y, skin, shirt, bob) {
  x = Math.round(x); y = Math.round(y + bob);
  X.fillStyle = 'rgba(0,0,0,.22)'; X.fillRect(x - 4, y + 15, 9, 3);
  X.fillStyle = '#2C2418'; X.fillRect(x - 4, y + 12, 3, 4); X.fillRect(x + 1, y + 12, 3, 4);
  X.fillStyle = shirt;    X.fillRect(x - 5, y + 5, 11, 8);
  X.fillStyle = skin;     X.fillRect(x - 4, y - 4, 9, 9);
  X.fillStyle = '#2C2418'; X.fillRect(x - 4, y - 5, 9, 4);
  X.fillStyle = '#161A2B'; X.fillRect(x - 2, y - 1, 2, 2); X.fillRect(x + 2, y - 1, 2, 2);
}

function drawPops() {
  X.font = '8px "Galmuri9",monospace'; X.textAlign = 'center';
  pops = pops.filter(p => p.t-- > 0);
  for (const p of pops) {
    X.globalAlpha = clamp(p.t / 30, 0, 1);
    X.fillStyle = '#161A2B'; X.fillText(p.txt, p.x + 1, p.y - (46 - p.t) * 0.35 + 1);
    X.fillStyle = p.c;       X.fillText(p.txt, p.x, p.y - (46 - p.t) * 0.35);
    X.globalAlpha = 1;
  }
  X.textAlign = 'left';
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => clamp(Math.round(c * (1 + amt)), 0, 255);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export { CITY_H, CITY_W, CV, MAP_H, MAP_W, STORE_H, STORE_W, T, X, cars, customers, draw, drawLabel, drawPerson, drawPops, fitCanvas, frame, hideTip, hitLot, hoverId, initCanvas, lotRect, moveTip, onCanvasClick, onCanvasMove, pops, setMode, shade, showTip, tipEl, toLogical, walkers, zoomInto };
