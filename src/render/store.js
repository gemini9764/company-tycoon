import { SECTORS, TIERS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, clamp, pick, rint, rnd, won } from '../core/util.js';
import { HH, HW, faces, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge } from './iso.js';
import { FOOT_Y, ROOM_H, ROOM_W, SPLIT_GX, STORE_H, STORE_O, STORE_W, X, customers, drawPerson, drawPops, drawSitter, drawText, faceOf, frame, newLook, pops, shade } from './canvas.js';
import { dailyRetail } from '../systems/economy.js';

/* ══════════════════════════════════════════════════════════════
   사옥 (경영, 쿼터뷰) — 좌 매장 / 우 사무실 + 사장실

   기획서 5장의 "고객 NPC가 물건을 사는 매장(아이러브커피) + 한쪽에 사무실
   (게임 개발 스토리, 월간 아이돌)" 구성.

   16×10 타일. gx 0..8 매장 / 9 칸막이 / 10..15 사무실.
   손님은 타일 격자 위에서 길을 찾으므로 집기를 뚫고 지나가지 않는다.
   ══════════════════════════════════════════════════════════════ */

const DOOR = { gx: 0, gy: 7 };          // 매장 서쪽 자동문
const SPAWN_GX = -4;                    // 문 밖 대기 위치

/* 매장 집기 — 타일 한 칸을 차지하고 손님이 못 지나간다 */
const FRIDGES = [{ gx: 1, gy: 0 }, { gx: 2, gy: 0 }, { gx: 3, gy: 0 }];
const FREEZERS = [{ gx: 5, gy: 0 }, { gx: 6, gy: 0 }];
const SHELVES = [
  { gx: 1, gy: 3 }, { gx: 2, gy: 3 }, { gx: 3, gy: 3 },
  { gx: 1, gy: 6 }, { gx: 2, gy: 6 }, { gx: 3, gy: 6 },
  { gx: 5, gy: 6 }, { gx: 6, gy: 6 },
];
const FLATS = [{ gx: 1, gy: 8 }, { gx: 2, gy: 8 }, { gx: 5, gy: 3 }];
const COUNTER = [{ gx: 7, gy: 2 }, { gx: 7, gy: 3 }];
const SHOP_PROPS = [{ gx: 6, gy: 8, k: 'carts' }, { gx: 7, gy: 8, k: 'plant' }, { gx: 4, gy: 0, k: 'plant' }, { gx: 7, gy: 5, k: 'pop' }];

const CLERK = { gx: 8, gy: 2 };         // 점원 자리 — 계산대 안쪽

const SHOP_BLOCK = new Set(
  [...FRIDGES, ...FREEZERS, ...SHELVES, ...FLATS, ...COUNTER, ...SHOP_PROPS, CLERK, { gx: 8, gy: 3 }].map(o => `${o.gx},${o.gy}`)
);

const QUEUE = { gx: 6, gy: 3 };         // 손님이 계산 줄 서는 자리

/* 사무실 — 책상 자리는 고용 순서대로 채운다 */
const DESKS = [
  { gx: 10, gy: 1 }, { gx: 11, gy: 1 }, { gx: 12, gy: 1 },
  { gx: 10, gy: 4 }, { gx: 11, gy: 4 }, { gx: 12, gy: 4 },
  { gx: 10, gy: 7 }, { gx: 11, gy: 7 }, { gx: 12, gy: 7 },
  { gx: 14, gy: 4 }, { gx: 15, gy: 4 },
  { gx: 14, gy: 7 }, { gx: 15, gy: 7 },
];

const BOSS = { desk: { gx: 14, gy: 1 }, seat: { gx: 14, gy: 0 } };   // 사장실 고정

const FLOOR_SHOP = '#C9BC9B', FLOOR_SHOP2 = '#B9A981';
const FLOOR_OFF = '#5A6180', FLOOR_OFF2 = '#525A78';
const FLOOR_BOSS = '#6E5A46';

let floorLayer = null, floorFor = null, clerk = null, boss = null;

function P(gx, gy) { return { x: isoX(STORE_O, gx, gy), y: isoY(STORE_O, gx, gy) }; }

/* ── 바닥 캐시 ───────────────────────────────────────────── */
function storeFloor() {
  if (floorLayer && floorFor === S) return floorLayer;
  floorFor = S;
  clerk = newLook('#F2B233');
  boss = newLook('#8B5CB8');
  const layer = makeLayer(STORE_W, STORE_H);
  const g = layer.ctx;
  if (g) {
    for (let gy = 0; gy < ROOM_H; gy++) for (let gx = 0; gx < ROOM_W; gx++) {
      const { x, y } = P(gx, gy);
      if (gx === SPLIT_GX) { rhomb(g, x, y, HW, HH, '#4A4436'); continue; }
      const alt = (gx + gy) % 2 === 0;
      if (gx < SPLIT_GX) rhomb(g, x, y, HW, HH, alt ? FLOOR_SHOP : FLOOR_SHOP2);
      else if (inBossRoom(gx, gy)) { rhomb(g, x, y, HW, HH, FLOOR_BOSS); rhombEdge(g, x, y, HW, HH, '#5C4A38'); }
      else { rhomb(g, x, y, HW, HH, alt ? FLOOR_OFF : FLOOR_OFF2); }
    }
    for (let i = 0; i < 3; i++) {                       // 출입 매트
      const { x, y } = P(DOOR.gx - i, DOOR.gy);
      rhomb(g, x, y, HW, HH, '#8A6A4A');
    }
  }
  floorLayer = layer;
  return floorLayer;
}

function inBossRoom(gx, gy) { return gx >= 13 && gy <= 2; }

/* ── 손님 ────────────────────────────────────────────────── */
function spawnCustomers() {
  customers.length = 0;
  for (let i = 0; i < 6; i++) customers.push(newCustomer());
}

function newCustomer() {
  const p = P(SPAWN_GX, DOOR.gy);
  const c = {
    x: p.x, y: p.y, look: newLook(), sp: rnd(0.9, 1.5),
    walk: 0, dir: 'e', wait: rint(0, 90), phase: 'shelf', path: [],
  };
  retarget(c);                    // 태어나자마자 진열대로 향한다
  return c;
}

/* 격자 위 최단 경로. 90칸짜리 판이라 너비 우선으로 충분하다.
   집기를 막아 두었으므로 손님이 진열대를 뚫고 지나가지 않는다. */
function walkable(gx, gy) {
  if (gy !== DOOR.gy && gx < 0) return false;
  if (gx < SPAWN_GX || gx > SPLIT_GX - 1 || gy < 0 || gy > ROOM_H - 1) return false;
  return gx < 0 || !SHOP_BLOCK.has(`${gx},${gy}`);
}

function findPath(from, to) {
  const key = (a, b) => `${a},${b}`;
  const prev = new Map([[key(from.gx, from.gy), null]]);
  const q = [from];
  let hit = null;
  while (q.length) {
    const c = q.shift();
    if (c.gx === to.gx && c.gy === to.gy) { hit = c; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.gx + dx, ny = c.gy + dy, k = key(nx, ny);
      if (prev.has(k) || !walkable(nx, ny)) continue;
      prev.set(k, c); q.push({ gx: nx, gy: ny });
    }
  }
  const out = [];
  for (let c = hit; c; c = prev.get(key(c.gx, c.gy))) out.unshift(c);
  return out.slice(1);
}

/** 손님이 현재 서 있는 타일 */
function tileOf(p) {
  const dx = (p.x - STORE_O.x) / HW, dy = (p.y - STORE_O.y) / HH;
  return { gx: Math.round((dy + dx) / 2), gy: Math.round((dy - dx) / 2) };
}

function retarget(p) {
  const from = tileOf(p);
  let to;
  if (p.phase === 'shelf') { const s = pick(SHELVES); to = { gx: s.gx, gy: s.gy + 1 }; }
  else if (p.phase === 'counter') to = { gx: QUEUE.gx, gy: QUEUE.gy + (Math.random() < 0.5 ? 0 : 1) };
  else to = { gx: SPAWN_GX, gy: DOOR.gy };
  if (!walkable(to.gx, to.gy)) to = { gx: 5, gy: 5 };
  p.path = findPath(from, to);
}

function stepCustomers(items) {
  const want = clamp(4 + Math.round(S.co.marketing * 3) + S.co.subs.length, 4, 14);
  while (customers.length < want) customers.push(newCustomer());
  while (customers.length > want) customers.pop();

  const spd = S.speed ? 0.7 + S.speed * 0.25 : 0.4;
  for (const p of customers) {
    if (p.wait > 0) { p.wait--; }
    else if (!p.path.length) advancePhase(p);
    else {
      const t = P(p.path[0].gx, p.path[0].gy);
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
      const step = p.sp * spd;
      if (d <= step) { p.x = t.x; p.y = t.y; p.path.shift(); }
      else { p.x += dx / d * step; p.y += dy / d * step; p.dir = faceOf(dx, dy, p.dir); }
      p.walk += step;
    }
    const px = p.x, py = p.y, look = p.look, dir = p.dir;
    const ph = p.wait > 0 ? 1 : Math.floor(p.walk / 5);
    items.push({ y: py, f: () => drawPerson(px, py, look, dir, ph) });
  }
}

function advancePhase(p) {
  if (p.phase === 'shelf') { p.wait = rint(40, 110); p.phase = 'counter'; }
  else if (p.phase === 'counter') {
    p.wait = rint(25, 60); p.phase = 'leave';
    const amt = Math.max(1000, dailyRetail(S) / Math.max(6, customers.length * 2.2));
    pops.push({ x: p.x, y: p.y - 26, t: 46, txt: '+' + won(amt), c: '#4BD69B' });
  } else if (p.phase === 'leave') { Object.assign(p, newCustomer()); return; }
  retarget(p);
}

/* ── 그리기 ──────────────────────────────────────────────── */
function drawStore() {
  X.fillStyle = '#151928'; X.fillRect(0, 0, STORE_W, STORE_H);
  const f = storeFloor();
  if (f && f.c) X.drawImage(f.c, 0, 0);

  drawWalls();

  const items = [];
  for (const o of FRIDGES) items.push({ y: P(o.gx, o.gy).y, f: () => drawFridge(o) });
  for (const o of FREEZERS) items.push({ y: P(o.gx, o.gy).y, f: () => drawFreezer(o) });
  for (const o of SHELVES) items.push({ y: P(o.gx, o.gy).y, f: () => drawShelf(o) });
  for (const o of FLATS) items.push({ y: P(o.gx, o.gy).y, f: () => drawFlat(o) });
  for (const o of SHOP_PROPS) items.push({ y: P(o.gx, o.gy).y, f: () => drawProp(o) });
  items.push({ y: P(COUNTER[1].gx, COUNTER[1].gy).y, f: drawCounter });
  addOffice(items);
  stepCustomers(items);

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.f();

  drawPops();
  drawFoot();
}

/* 뒤쪽 두 면만 세운 컷어웨이. 앞쪽은 터야 안이 보인다. */
function drawWalls() {
  for (let gx = 0; gx < ROOM_W; gx++) {                 // 북동쪽 벽 (gy = -1)
    const { x, y } = P(gx, -1);
    const shop = gx < SPLIT_GX;
    prism(X, x, y, HW, HH, 34, shop ? '#7D6B53' : '#585140', shop ? '#5C4E3C' : '#3E3A2C', shop ? '#6B5B47' : '#4A4436');
  }
  for (let gy = -1; gy < ROOM_H; gy++) {                // 북서쪽 벽 (gx = -1)
    if (gy === DOOR.gy) continue;                        // 자동문 자리
    const { x, y } = P(-1, gy);
    prism(X, x, y, HW, HH, 34, '#6E5E48', '#5C4E3C', '#4A3E30');
  }
  const d = P(-1, DOOR.gy);                              // 유리 자동문
  prism(X, d.x, d.y, HW, HH, 34, '#9AB8D0', '#5C4E3C', '#8AB4D8');
  X.fillStyle = 'rgba(255,255,255,.30)';
  isoWin(X, d.x, d.y, HW, HH, 'r', 2, 6, 8, 20, 'rgba(255,255,255,.22)');

  drawSignboard();
  drawWhiteboard();
  drawPartition();
}

/** 매장 간판 — 북동쪽 벽 위에 얹는다 */
function drawSignboard() {
  const a = P(1, -1), b = P(4, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const w = 46;
  X.fillStyle = '#14182A'; X.fillRect(Math.round(x - w / 2), Math.round(y - 36), w, 15);
  X.fillStyle = '#F2B233'; X.fillRect(Math.round(x - w / 2), Math.round(y - 36), w, 3);
  drawText(x, y - 25, S.co.name, { size: 12, color: '#FFE9A8', shadow: false });
}

/** 사무실 화이트보드 — 협상 중이면 진행도/성공도, 아니면 다음 등급 목표 */
function drawWhiteboard() {
  const a = P(10, -1), b = P(11, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const w = 62, h = 22, ty = Math.round(y - 38);
  X.fillStyle = '#20263A'; X.fillRect(Math.round(x - w / 2) - 1, ty - 1, w + 2, h + 2);
  X.fillStyle = '#EDEAE0'; X.fillRect(Math.round(x - w / 2), ty, w, h);
  X.fillStyle = '#C9C4B4'; X.fillRect(Math.round(x - w / 2), ty + h - 2, w, 2);
  if (S.nego) {
    drawText(x, ty + 9, `협상 · ${S.nego.name}`, { size: 10, color: '#26304A', shadow: false });
    bar(x - w / 2 + 4, ty + 12, w - 8, 3, S.nego.progress / 100, '#4A86C7');
    bar(x - w / 2 + 4, ty + 17, w - 8, 3, S.nego.success / 100, '#2FA37A');
  } else {
    const t = TIERS[S.co.tier];
    drawText(x, ty + 9, t.name, { size: 10, color: '#26304A', shadow: false });
    drawText(x, ty + 19, t.goal, { size: 10, color: '#5C5340', shadow: false });
  }
}

function bar(x, y, w, h, v, c) {
  X.fillStyle = '#C9C4B4'; X.fillRect(Math.round(x), Math.round(y), w, h);
  X.fillStyle = c; X.fillRect(Math.round(x), Math.round(y), Math.round(w * clamp(v, 0, 1)), h);
}

/** 매장과 사무실을 가르는 칸막이 + 사장실 벽 */
function drawPartition() {
  for (let gy = 0; gy < ROOM_H; gy++) {
    if (gy === 4) continue;                              // 통로
    const { x, y } = P(SPLIT_GX, gy);
    prism(X, x, y, HW, HH, 26, '#4A3E2A', '#2C2418', '#3A3020');
  }
  const d = P(SPLIT_GX, 4);
  prism(X, d.x, d.y, HW, HH, 5, '#4A3E2A', '#2C2418', '#3A3020');
  for (let gy = 0; gy <= 2; gy++) {                      // 사장실 세로 벽
    const { x, y } = P(12, gy);
    prism(X, x, y, HW, HH, 20, '#5A4A38', '#3A2E20', '#4A3C2C');
  }
  for (let gx = 13; gx < ROOM_W; gx++) {                 // 사장실 가로 벽 (문 한 칸)
    const { x, y } = P(gx, 3);
    if (gx === 13) { prism(X, x, y, HW, HH, 4, '#5A4A38', '#3A2E20', '#4A3C2C'); continue; }
    prism(X, x, y, HW, HH, 20, '#5A4A38', '#3A2E20', '#4A3C2C');
  }
}

/* ── 매장 집기 ───────────────────────────────────────────── */
/** 인수한 업종이 늘수록 진열 상품 색이 늘어난다 */
function palette() {
  return ['#7FB069', '#E0A24A', ...S.co.subs.slice(0, 6).map(s => SECTORS[s.sector].color)];
}

function drawFridge(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  prism(X, x, y, 13, 6, 26, '#DDE3F0', '#8A93A8', '#C6CCE2');
  isoWin(X, x, y, 13, 6, 'r', 3, 4, 18, 18, '#8FB6D6');
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++)
    isoWin(X, x, y, 13, 6, 'r', 4 + k * 6, 6 + r * 9, 4, 7, pal[(o.gx + r + k) % pal.length]);
  X.fillStyle = '#8A8F9E'; X.fillRect(Math.round(x + 9), Math.round(y - 12), 2, 6);
}

/* 개방형 냉동고 — 위가 트여 안이 보인다 */
function drawFreezer(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  prism(X, x, y, 14, 7, 12, '#8FA8C4', '#7A8496', '#B7C3D6');
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++)
    prism(X, x - 6 + k * 6, y - 12 + (k - 1) * 3 + r * 5, 3, 2, 4, pal[(o.gx + r + k) % pal.length], '#5E6478', shade(pal[(o.gx + r + k) % pal.length], -0.25));
  faces(X, x, y, 14, 7, 12, 13, '#DDE3F0', '#EEF2FA');
}

function drawShelf(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  X.save(); X.globalAlpha = 0.2; rhomb(X, x + 2, y + 1, 14, 7, '#000000'); X.restore();
  prism(X, x, y, 14, 7, 17, '#9C7A56', '#6B5136', '#8A6A4A');
  for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
    const c = pal[(o.gx * 2 + o.gy + r + k) % pal.length];
    isoWin(X, x, y, 14, 7, 'r', 3 + k * 6, 3 + r * 7, 4, 5, c);
    isoWin(X, x, y, 14, 7, 'l', 3 + k * 6, 3 + r * 7, 4, 5, shade(c, -0.2));
  }
  faces(X, x, y, 14, 7, 8, 9, '#D8CBA8', '#F5EFDD');           // 가격표 띠
}

function drawFlat(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  prism(X, x, y, 14, 7, 8, '#9C7A56', '#6B5136', '#8A6A4A');
  for (let k = 0; k < 3; k++) {
    const c = pal[(o.gx + k) % pal.length];
    prism(X, x - 7 + k * 7, y - 8 + (k - 1) * 3, 4, 2, 5, shade(c, 0.25), shade(c, -0.25), c);
  }
}

function drawCounter() {
  for (const o of COUNTER) {
    const { x, y } = P(o.gx, o.gy);
    X.save(); X.globalAlpha = 0.2; rhomb(X, x + 2, y + 1, 14, 7, '#000000'); X.restore();
    prism(X, x, y, 14, 7, 14, '#7186AD', '#3E4A66', '#5A6B8C');
    faces(X, x, y, 14, 7, 14, 15, '#8FA4CC', '#9DB2D8');
  }
  const a = P(COUNTER[0].gx, COUNTER[0].gy);
  X.fillStyle = '#20263A'; X.fillRect(Math.round(a.x) - 5, Math.round(a.y) - 26, 11, 8);   // POS
  X.fillStyle = '#8AB4D8'; X.fillRect(Math.round(a.x) - 4, Math.round(a.y) - 25, 9, 5);
  const c = P(CLERK.gx, CLERK.gy);
  drawPerson(c.x, c.y, clerk, 'w', 1);                                                     // 점원
}

function drawProp(o) {
  const { x, y } = P(o.gx, o.gy);
  if (o.k === 'plant') {
    prism(X, x, y, 7, 4, 7, '#B96A3C', '#7A3E22', '#A0562F');
    prism(X, x, y - 7, 9, 5, 9, '#3E8A56', '#245239', '#2F6B45');
  } else if (o.k === 'carts') {
    for (let i = 0; i < 3; i++) prism(X, x - 4 + i * 4, y - 2 + i * 2, 7, 4, 9, '#C6CCE2', '#5E6478', '#9AA0B0');
  } else {
    X.fillStyle = '#59627E'; X.fillRect(Math.round(x), Math.round(y - 14), 1, 14);
    X.fillStyle = '#D0453B'; X.fillRect(Math.round(x - 8), Math.round(y - 24), 18, 11);
    X.fillStyle = 'rgba(255,255,255,.78)';
    X.fillRect(Math.round(x - 6), Math.round(y - 21), 14, 2); X.fillRect(Math.round(x - 6), Math.round(y - 18), 9, 2);
  }
}

/* ── 사무실 ──────────────────────────────────────────────── */
/* 직원은 책상 북쪽(뒤)에 앉는다. 책상이 나중에 그려져 하반신을 가리고
   얼굴은 그대로 보인다 — 탑다운에서 모니터가 얼굴을 덮던 문제가 사라진다. */
function addOffice(items) {
  const staff = S.staff.slice(0, DESKS.length);
  staff.forEach((e, i) => {
    const d = DESKS[i], seat = P(d.gx, d.gy - 1), desk = P(d.gx, d.gy);
    if (!e.look) e.look = newLook(e.trait.id === 'star' ? '#F2B233' : null);
    items.push({ y: seat.y, f: () => e.onTeam ? drawEmptyChair(seat, d) : drawSitter(seat.x, seat.y, e.look, 's', Math.floor(frame / 30 + i) % 2) });
    items.push({ y: desk.y, f: () => drawDesk(desk, !e.onTeam, i) });
  });

  const bd = P(BOSS.desk.gx, BOSS.desk.gy), bs = P(BOSS.seat.gx, BOSS.seat.gy);
  items.push({ y: bs.y, f: () => drawSitter(bs.x, bs.y, boss, 's', Math.floor(frame / 40) % 2) });
  items.push({ y: bd.y, f: () => drawBossDesk(bd) });
  for (const o of [{ gx: 13, gy: 0, k: 'shelf' }, { gx: 15, gy: 2, k: 'sofa' }, { gx: 13, gy: 2, k: 'plant' },
                   { gx: 13, gy: 5, k: 'copier' }, { gx: 13, gy: 8, k: 'cooler' }, { gx: 15, gy: 9, k: 'cabinet' }, { gx: 10, gy: 9, k: 'plant' }]) {
    const p = P(o.gx, o.gy);
    items.push({ y: p.y, f: () => drawOfficeProp(p, o.k) });
  }
}

function drawEmptyChair(seat, d) {
  X.fillStyle = 'rgba(0,0,0,.20)'; rhomb(X, seat.x, seat.y, 8, 4, 'rgba(0,0,0,.20)');
  prism(X, seat.x, seat.y, 8, 4, 4, '#4C5673', '#2A3046', '#3E4763');
  X.fillStyle = '#3E4763'; X.fillRect(Math.round(seat.x) - 6, Math.round(seat.y) - 13, 12, 9);
  drawText(seat.x, seat.y - 18, '출장', { size: 10, color: '#8FBEEA' });
}

function drawDesk(p, on, i) {
  const { x, y } = p;
  X.save(); X.globalAlpha = 0.22; rhomb(X, x + 2, y + 1, 14, 7, '#000000'); X.restore();
  prism(X, x, y, 14, 7, 10, '#B08A62', '#6B5136', '#9C7A56');
  // 모니터는 책상 왼쪽에 둔다. 가운데에 두면 앉은 사람 얼굴을 가린다.
  X.fillStyle = '#20263A'; X.fillRect(Math.round(x) - 11, Math.round(y) - 20, 10, 8);
  X.fillStyle = on ? (Math.floor(frame / 40 + i) % 2 ? '#4ECDC4' : '#4A86C7') : '#2C3550';
  X.fillRect(Math.round(x) - 10, Math.round(y) - 19, 8, 6);
  X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x) - 8, Math.round(y) - 11, 7, 2);    // 키보드
  X.fillStyle = '#F5EFDD'; X.fillRect(Math.round(x) + 2, Math.round(y) - 13, 7, 5);    // 서류
  X.fillStyle = '#D0453B'; X.fillRect(Math.round(x) + 8, Math.round(y) - 13, 3, 4);    // 머그
}

function drawBossDesk(p) {
  const { x, y } = p;
  X.save(); X.globalAlpha = 0.24; rhomb(X, x + 2, y + 1, 18, 9, '#000000'); X.restore();
  prism(X, x, y, 18, 9, 12, '#8A6A4A', '#4E3A24', '#6B5136');
  faces(X, x, y, 18, 9, 12, 13, '#B08A62', '#C69A6E');
  X.fillStyle = '#20263A'; X.fillRect(Math.round(x) - 14, Math.round(y) - 24, 10, 8);
  X.fillStyle = '#4ECDC4'; X.fillRect(Math.round(x) - 13, Math.round(y) - 23, 8, 6);
  X.fillStyle = '#F2B233'; X.fillRect(Math.round(x) + 4, Math.round(y) - 16, 6, 4);    // 명패
  X.fillStyle = '#F5EFDD'; X.fillRect(Math.round(x) - 3, Math.round(y) - 15, 8, 5);
  drawText(x, y - 30, '사장실', { size: 10, color: '#FFD57A' });
}

function drawOfficeProp(p, k) {
  const { x, y } = p;
  if (k === 'plant') {
    prism(X, x, y, 7, 4, 7, '#B96A3C', '#7A3E22', '#A0562F');
    prism(X, x, y - 7, 9, 5, 9, '#3E8A56', '#245239', '#2F6B45');
  } else if (k === 'cooler') {
    prism(X, x, y, 7, 4, 12, '#DDE3F0', '#7A8090', '#C6CCE2');
    prism(X, x, y - 12, 6, 3, 8, '#A8CCE4', '#5E7E96', '#8AB4D8');
  } else if (k === 'copier') {
    prism(X, x, y, 10, 5, 14, '#A6ACBC', '#5E6478', '#8A8F9E');
    X.fillStyle = '#20263A'; X.fillRect(Math.round(x) - 6, Math.round(y) - 12, 12, 3);
    X.fillStyle = '#2FA37A'; X.fillRect(Math.round(x) + 4, Math.round(y) - 17, 3, 2);
  } else if (k === 'cabinet') {
    prism(X, x, y, 10, 5, 22, '#A6ACBC', '#5E6478', '#8A8F9E');
    for (let i = 0; i < 3; i++) isoWin(X, x, y, 10, 5, 'r', 3, 3 + i * 6, 6, 4, '#6E7488');
  } else if (k === 'sofa') {
    prism(X, x, y, 13, 6, 6, '#5A6B8C', '#2E3A52', '#46567A');
    X.fillStyle = '#46567A'; X.fillRect(Math.round(x) - 11, Math.round(y) - 14, 11, 9);
  } else {
    prism(X, x, y, 10, 5, 20, '#8A6A4A', '#4E3A24', '#6B5136');
    const pal = ['#D0453B', '#4A86C7', '#2FA37A', '#F2B233'];
    for (let i = 0; i < 3; i++) isoWin(X, x, y, 10, 5, 'r', 3 + i * 5, 5, 4, 9, pal[i % 4]);
  }
}

/* ── 하단 상태 스트립 ────────────────────────────────────── */
function drawFoot() {
  X.fillStyle = '#14182A'; X.fillRect(0, FOOT_Y, STORE_W, STORE_H - FOOT_Y);
  X.fillStyle = '#39415F'; X.fillRect(0, FOOT_Y, STORE_W, 1);
  const net = S.co.revToday - S.co.costToday;
  const cells = [
    ['일매출', won(S.co.revToday), '#FFD57A'],
    ['순익', (net >= 0 ? '+' : '') + won(net), net >= 0 ? '#4BD69B' : '#F07068'],
    ['인지도', '×' + S.co.marketing.toFixed(2), '#8FBEEA'],
    ['손님', customers.length + '명', '#E3D8BB'],
    ['직원', S.staff.length + '명', '#E3D8BB'],
  ];
  const cw = STORE_W / cells.length;
  cells.forEach(([k, v, c], i) => {
    if (i) { X.fillStyle = '#2A3046'; X.fillRect(i * cw, FOOT_Y + 3, 1, 10); }
    drawText(i * cw + cw / 2, FOOT_Y + 12, `${k} ${v}`, { size: 10, color: c, shadow: false });
  });
}

export { BOSS, CLERK, COUNTER, DESKS, DOOR, FLATS, FREEZERS, FRIDGES, drawFreezer, P, QUEUE, SHELVES, SHOP_BLOCK, SHOP_PROPS, SPAWN_GX, addOffice, advancePhase, bar, drawBossDesk, drawCounter, drawDesk, drawEmptyChair, drawFlat, drawFoot, drawFridge, drawOfficeProp, drawPartition, drawProp, drawShelf, drawSignboard, drawStore, drawWalls, drawWhiteboard, findPath, inBossRoom, newCustomer, palette, retarget, spawnCustomers, stepCustomers, storeFloor, tileOf, walkable };
