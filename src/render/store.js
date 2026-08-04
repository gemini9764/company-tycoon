import { SECTORS, TIERS } from '../core/data.js';
import { S } from '../core/state.js';
import { viewRand } from '../core/rng.js';
import { $, clamp, vpick, vrint, vrnd, won } from '../core/util.js';
import { HH, HW, faces, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge } from './iso.js';
import { FOOT_Y, ROOM_H, ROOM_W, SPLIT_GX, STORE_H, STORE_O, STORE_W, X, customers, drawPerson, drawPops, drawSitter, drawText, faceOf, frame, newLook, pops, rrect, shade } from './canvas.js';
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

/* ── 시설 증설로 늘어나는 집기 ────────────────────────────────
   레벨을 올리면 숫자만 오르는 게 아니라 매장에 실제로 집기가 는다.
   늘어난 칸은 손님이 못 지나가야 하므로 충돌 판정도 같이 따라가야 한다 —
   그래서 SHOP_BLOCK 을 그대로 쓰지 않고 `blockedAt()` 을 거친다.

   자리는 통로를 막지 않는 곳으로만 골랐다. gy=2·4·5·7·9 가로 통로와
   gx=0·4·6 세로 통로는 어느 레벨에서도 열려 있어야 한다.
   ─────────────────────────────────────────────────────────── */
const EXTRA_SHELF   = [{ gx: 1, gy: 1 }, { gx: 2, gy: 1 }, { gx: 3, gy: 1 }];   // 냉장고 아래 한 줄
const EXTRA_FRIDGE  = [{ gx: 7, gy: 0 }, { gx: 7, gy: 1 }, { gx: 4, gy: 1 }];   // 냉장 설비
const EXTRA_COUNTER = [{ gx: 7, gy: 4 }];                                        // 계산대 2번대
const CLERK2 = { gx: 8, gy: 4 };

const fl = k => (S.co.facil && S.co.facil[k]) || 0;

/** 지금 레벨에서 실제로 깔린 집기 목록 */
function shelvesNow() { return SHELVES.concat(EXTRA_SHELF.slice(0, fl('shelf'))); }

function fridgesNow() { return FRIDGES.concat(EXTRA_FRIDGE.slice(0, fl('cold'))); }

function countersNow() { return COUNTER.concat(fl('counter') ? EXTRA_COUNTER : []); }

/** 충돌 판정 — 기본 집기 + 증설분 */
function blockedAt(gx, gy) {
  if (SHOP_BLOCK.has(`${gx},${gy}`)) return true;
  const ex = [...EXTRA_SHELF.slice(0, fl('shelf')), ...EXTRA_FRIDGE.slice(0, fl('cold'))];
  if (fl('counter')) ex.push(...EXTRA_COUNTER, CLERK2);
  return ex.some(o => o.gx === gx && o.gy === gy);
}

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

let floorLayer = null, floorFor = null, floorKey = '', clerk = null, clerk2 = null, boss = null;

/** 바닥·마감이 시설 레벨을 따라가므로 캐시 키에 레벨을 넣는다 */
function facilKey() { return ['shelf', 'counter', 'cold', 'office'].map(fl).join(''); }

function P(gx, gy) { return { x: isoX(STORE_O, gx, gy), y: isoY(STORE_O, gx, gy) }; }

/* ── 바닥 캐시 ───────────────────────────────────────────── */
function storeFloor() {
  const key = facilKey();
  if (floorLayer && floorFor === S && floorKey === key) return floorLayer;
  floorFor = S; floorKey = key;
  clerk = clerk || newLook('#F2B233');
  clerk2 = clerk2 || newLook('#E8E4D8');
  boss = boss || newLook('#8B5CB8');
  const layer = makeLayer(STORE_W, STORE_H);
  const g = layer.ctx;
  if (g) {
    for (let gy = 0; gy < ROOM_H; gy++) for (let gx = 0; gx < ROOM_W; gx++) {
      const { x, y } = P(gx, gy);
      if (gx === SPLIT_GX) { rhomb(g, x, y, HW, HH, '#4A4436'); continue; }
      const alt = (gx + gy) % 2 === 0;
      if (gx < SPLIT_GX) { const f = shopFloorPal(); rhomb(g, x, y, HW, HH, alt ? f[0] : f[1]); }
      else if (inBossRoom(gx, gy)) { rhomb(g, x, y, HW, HH, FLOOR_BOSS); rhombEdge(g, x, y, HW, HH, '#5C4A38'); }
      else { const f = offFloorPal(); rhomb(g, x, y, HW, HH, alt ? f[0] : f[1]); }
    }
    for (let i = 0; i < 3; i++) {                       // 출입 매트
      const { x, y } = P(DOOR.gx - i, DOOR.gy);
      rhomb(g, x, y, HW, HH, '#8A6A4A');
    }
  }
  floorLayer = layer;
  return floorLayer;
}

/* 시설을 올릴수록 바닥 마감이 좋아진다 — 나무 → 타일 → 대리석.
   숫자 말고 화면으로도 성장을 보여 주려는 것. */
function shopFloorPal() {
  const sum = fl('shelf') + fl('counter') + fl('cold') + fl('office');
  if (sum >= 8) return ['#E4E0D4', '#D4CFC0'];        // 대리석
  if (sum >= 4) return ['#D6CBAE', '#C6B996'];        // 타일
  return [FLOOR_SHOP, FLOOR_SHOP2];                    // 나무
}

/* 사무실도 같이 좋아진다 */
function offFloorPal() {
  const lv = fl('office');
  if (lv >= 3) return ['#5E6A92', '#56628A'];
  if (lv >= 1) return ['#5A6486', '#525C7E'];
  return [FLOOR_OFF, FLOOR_OFF2];
}

function inBossRoom(gx, gy) { return gx >= 13 && gy <= 2; }

/* 사옥에도 클릭할 것을 둔다. 지금까지 사옥 캔버스는 판정이 아예 없어서
   보고만 있는 화면이었다. 사장실 책상 → 결재, 계산대 → 매장 창. */
const HOTSPOTS = [
  { k: 'boss',    tiles: [BOSS.desk, BOSS.seat], tip: '사장실 — 오늘의 결재' },
  { k: 'counter', tiles: COUNTER,                tip: '계산대 — 매장 운영' },
];

/** 월드 좌표 → 사옥 핫스팟. 없으면 null. */
function storeHit(p) {
  const g = tileOf(p);
  for (const h of HOTSPOTS) {
    if (h.tiles.some(o => o.gx === g.gx && o.gy === g.gy)) return h;
  }
  return null;
}

/* ── 손님 ────────────────────────────────────────────────── */
function spawnCustomers() {
  customers.length = 0;
  for (let i = 0; i < 6; i++) customers.push(newCustomer());
}

function newCustomer() {
  const p = P(SPAWN_GX, DOOR.gy);
  const c = {
    x: p.x, y: p.y, look: newLook(), sp: vrnd(1.35, 2.25),
    walk: 0, dir: 'e', wait: vrint(0, 90), phase: 'shelf', path: [],
  };
  retarget(c);                    // 태어나자마자 진열대로 향한다
  return c;
}

/* 격자 위 최단 경로. 90칸짜리 판이라 너비 우선으로 충분하다.
   집기를 막아 두었으므로 손님이 진열대를 뚫고 지나가지 않는다. */
function walkable(gx, gy) {
  if (gy !== DOOR.gy && gx < 0) return false;
  if (gx < SPAWN_GX || gx > SPLIT_GX - 1 || gy < 0 || gy > ROOM_H - 1) return false;
  return gx < 0 || !blockedAt(gx, gy);
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
  if (p.phase === 'shelf') { const s = vpick(shelvesNow()); to = { gx: s.gx, gy: s.gy + 1 }; }
  else if (p.phase === 'counter') to = { gx: QUEUE.gx, gy: QUEUE.gy + (viewRand() < 0.5 ? 0 : 1) };
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
    const ph = p.wait > 0 ? 1 : Math.floor(p.walk / 8);
    items.push({ y: py, f: () => drawPerson(px, py, look, dir, ph) });
  }
}

function advancePhase(p) {
  if (p.phase === 'shelf') { p.wait = vrint(40, 110); p.phase = 'counter'; }
  else if (p.phase === 'counter') {
    p.wait = vrint(25, 60); p.phase = 'leave';
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
  for (const o of fridgesNow()) items.push({ y: P(o.gx, o.gy).y, f: () => drawFridge(o) });
  for (const o of FREEZERS) items.push({ y: P(o.gx, o.gy).y, f: () => drawFreezer(o) });
  for (const o of shelvesNow()) items.push({ y: P(o.gx, o.gy).y, f: () => drawShelf(o) });
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
  /* 벽은 통짜 상자였다. 걸레받이와 허리 몰딩을 넣어 높이를 읽히게 한다. */
  for (let gx = 0; gx < ROOM_W; gx++) {                 // 북동쪽 벽 (gy = -1)
    const { x, y } = P(gx, -1);
    const shop = gx < SPLIT_GX;
    prism(X, x, y, HW, HH, 51, shop ? '#7D6B53' : '#585140', shop ? '#5C4E3C' : '#3E3A2C', shop ? '#6B5B47' : '#4A4436');
    faces(X, x, y, HW, HH, 0, 5, shop ? '#4A3E2E' : '#332F24', shop ? '#584A38' : '#3C3829');    // 걸레받이
    faces(X, x, y, HW, HH, 22, 24, shop ? '#6B5B47' : '#4A4436', shop ? '#8A7659' : '#635944');  // 허리 몰딩
  }
  for (let gy = -1; gy < ROOM_H; gy++) {                // 북서쪽 벽 (gx = -1)
    if (gy === DOOR.gy) continue;                        // 자동문 자리
    const { x, y } = P(-1, gy);
    prism(X, x, y, HW, HH, 51, '#6E5E48', '#5C4E3C', '#4A3E30');
    faces(X, x, y, HW, HH, 0, 5, '#443A2C', '#3A3025');
    faces(X, x, y, HW, HH, 22, 24, '#6B5B47', '#584A38');
  }
  const d = P(-1, DOOR.gy);                              // 유리 자동문
  prism(X, d.x, d.y, HW, HH, 51, '#9AB8D0', '#5C4E3C', '#8AB4D8');
  faces(X, d.x, d.y, HW, HH, 0, 5, '#443A2C', '#3A3025');
  glassPanel(d.x, d.y, HW, HH, 'r', 4, 6, 8, 32, '#A8C8DC');       // 두 짝으로 나뉜 유리
  glassPanel(d.x, d.y, HW, HH, 'r', 14, 6, 8, 32, '#A8C8DC');
  faces(X, d.x, d.y, HW, HH, 42, 45, '#6B5B47', '#8A7659');        // 상부 문틀

  drawSignboard();
  drawWhiteboard();
  drawPartition();
}

/** 매장 간판 — 북동쪽 벽 위에 얹는다 */
function drawSignboard() {
  const a = P(1, -1), b = P(4, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const w = 69;
  X.fillStyle = '#14182A'; X.fillRect(Math.round(x - w / 2), Math.round(y - 54), w, 23);
  X.fillStyle = '#F2B233'; X.fillRect(Math.round(x - w / 2), Math.round(y - 54), w, 5);
  drawText(x, y - 38, S.co.name, { size: 12, color: '#FFE9A8', shadow: false });
}

/** 사무실 화이트보드 — 협상 중이면 진행도/성공도, 아니면 다음 등급 목표 */
function drawWhiteboard() {
  const a = P(10, -1), b = P(11, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const w = 93, h = 33, ty = Math.round(y - 57);
  X.fillStyle = '#20263A'; X.fillRect(Math.round(x - w / 2) - 2, ty - 2, w + 4, h + 4);
  X.fillStyle = '#EDEAE0'; X.fillRect(Math.round(x - w / 2), ty, w, h);
  X.fillStyle = '#C9C4B4'; X.fillRect(Math.round(x - w / 2), ty + h - 3, w, 3);
  if (S.nego) {
    drawText(x, ty + 14, `협상 · ${S.nego.name}`, { size: 10, color: '#26304A', shadow: false });
    bar(x - w / 2 + 6, ty + 18, w - 12, 5, S.nego.progress / 100, '#4A86C7');
    bar(x - w / 2 + 6, ty + 26, w - 12, 5, S.nego.success / 100, '#2FA37A');
  } else {
    const t = TIERS[S.co.tier];
    drawText(x, ty + 14, t.name, { size: 10, color: '#26304A', shadow: false });
    drawText(x, ty + 29, t.goal, { size: 10, color: '#5C5340', shadow: false });
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
    prism(X, x, y, HW, HH, 39, '#4A3E2A', '#2C2418', '#3A3020');
  }
  const d = P(SPLIT_GX, 4);
  prism(X, d.x, d.y, HW, HH, 8, '#4A3E2A', '#2C2418', '#3A3020');
  for (let gy = 0; gy <= 2; gy++) {                      // 사장실 세로 벽
    const { x, y } = P(12, gy);
    prism(X, x, y, HW, HH, 30, '#5A4A38', '#3A2E20', '#4A3C2C');
  }
  for (let gx = 13; gx < ROOM_W; gx++) {                 // 사장실 가로 벽 (문 한 칸)
    const { x, y } = P(gx, 3);
    if (gx === 13) { prism(X, x, y, HW, HH, 6, '#5A4A38', '#3A2E20', '#4A3C2C'); continue; }
    prism(X, x, y, HW, HH, 30, '#5A4A38', '#3A2E20', '#4A3C2C');
  }
}

/* ── 매장 집기 ───────────────────────────────────────────── */
/** 재고율 0~1. 진열대가 비어 보이게 해서 발주 시점을 그림으로 알린다. */
function invRatio() { return clamp((S.co.inv ?? 100) / 100, 0, 1); }

/** n칸 중 재고만큼만 채운다 */
function stocked(n) { return Math.max(0, Math.round(n * invRatio())); }

/** 인수한 업종이 늘수록 진열 상품 색이 늘어난다 */
function palette() {
  return ['#7FB069', '#E0A24A', ...S.co.subs.slice(0, 6).map(s => SECTORS[s.sector].color)];
}

/* ── 매장 집기 (재작화) ──────────────────────────────────────
   도시에 쓴 방법을 그대로 가져왔다 — 모서리를 깎고, 면을 층으로 나누고,
   유리에 틀과 반사를 넣는다. **색은 건드리지 않았다.**

   집기가 차지하는 타일과 크기는 그대로다. 손님 경로(`blockedAt`)와 얽혀 있어
   여기를 건드리면 통행이 막힌다. ─────────────────────────── */

/** 유리 문/면 — 틀 + 유리 + 대각 반사 */
function glassPanel(x, y, rx, ry, side, off, up, w, hgt, glass) {
  isoWin(X, x, y, rx, ry, side, off - 2, up - 1, w + 4, hgt + 2, '#8A93A8');
  isoWin(X, x, y, rx, ry, side, off, up, w, hgt, glass);
  for (let i = 0; i < 3; i++) {                    // 비스듬한 하이라이트
    isoWin(X, x, y, rx, ry, side, off + 2 + i * 4, up + hgt - 6 - i * 4, 2, 4, 'rgba(255,255,255,.30)');
  }
}

function drawFridge(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  X.save(); X.globalAlpha = 0.18; rhomb(X, x + 3, y + 2, 20, 10, '#000000'); X.restore();
  prism(X, x, y, 20, 10, 39, '#DDE3F0', '#8A93A8', '#C6CCE2');
  faces(X, x, y, 20, 10, 0, 4, '#7A8496', '#A6ADBC');            // 킥 플레이트
  faces(X, x, y, 20, 10, 35, 37, '#B7BFD0', '#D2D8E6');          // 상부 통풍구
  glassPanel(x, y, 20, 10, 'r', 4, 6, 26, 27, '#8FB6D6');
  const putR = stocked(6);
  for (let i = 0; i < putR; i++) {
    const r = i < 3 ? 0 : 1, k = i % 3;
    const c = pal[(o.gx + r + k) % pal.length];
    isoWin(X, x, y, 20, 10, 'r', 6 + k * 9, 9 + r * 14, 6, 11, c);
    isoWin(X, x, y, 20, 10, 'r', 6 + k * 9, 9 + r * 14, 6, 2, shade(c, 0.28));
  }
  for (let r = 0; r < 2; r++) {                                   // 선반 유리
    isoWin(X, x, y, 20, 10, 'r', 4, 7 + r * 14, 26, 2, 'rgba(255,255,255,.42)');
  }
  X.fillStyle = '#8A8F9E'; X.fillRect(Math.round(x + 14), Math.round(y - 20), 3, 11);   // 손잡이
  X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x + 14), Math.round(y - 20), 3, 2);
}

/* 개방형 냉동고 — 위가 트여 안이 보인다 */
function drawFreezer(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  X.save(); X.globalAlpha = 0.18; rhomb(X, x + 3, y + 2, 22, 11, '#000000'); X.restore();
  prism(X, x, y, 22, 11, 18, '#8FA8C4', '#7A8496', '#B7C3D6');
  faces(X, x, y, 22, 11, 0, 3, '#68727F', '#94A0B0');             // 굽도리
  rhomb(X, x, y - 18, 17, 8, '#6E7C90');                          // 안쪽 그늘
  const putF = stocked(6);
  for (let i = 0; i < putF; i++) {
    const r = i < 3 ? 0 : 1, k = i % 3, c = pal[(o.gx + r + k) % pal.length];
    prism(X, x - 9 + k * 9, y - 18 + (k - 1) * 5 + r * 8, 4, 2, 6, shade(c, 0.20), '#5E6478', shade(c, -0.25));
  }
  faces(X, x, y, 22, 11, 18, 20, '#DDE3F0', '#EEF2FA');           // 테두리
  X.fillStyle = 'rgba(255,255,255,.34)';                          // 성에
  X.fillRect(Math.round(x - 12), Math.round(y - 9), 8, 2); X.fillRect(Math.round(x + 5), Math.round(y - 6), 6, 2);
}

function drawShelf(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  X.save(); X.globalAlpha = 0.18; rhomb(X, x + 3, y + 2, 22, 11, '#000000'); X.restore();
  prism(X, x, y, 22, 11, 26, '#9C7A56', '#6B5136', '#8A6A4A');
  faces(X, x, y, 22, 11, 0, 3, '#5C452D', '#79593B');             // 받침대
  for (let r = 0; r < 2; r++) {                                   // 선반 판
    faces(X, x, y, 22, 11, 5 + r * 11, 7 + r * 11, '#7A5C3E', '#A98A63');
  }
  const put = stocked(6);
  for (let i = 0; i < put; i++) {
    const r = i < 3 ? 0 : 1, k = i % 3;
    const c = pal[(o.gx * 2 + o.gy + r + k) % pal.length];
    isoWin(X, x, y, 22, 11, 'r', 5 + k * 9, 7 + r * 11, 6, 8, c);
    isoWin(X, x, y, 22, 11, 'r', 5 + k * 9, 13 + r * 11, 6, 2, shade(c, 0.30));   // 상품 윗면
    isoWin(X, x, y, 22, 11, 'l', 5 + k * 9, 7 + r * 11, 6, 8, shade(c, -0.22));
  }
  faces(X, x, y, 22, 11, 24, 26, '#D8CBA8', '#F5EFDD');           // 가격표 띠
  X.fillStyle = '#8A6A4A'; X.fillRect(Math.round(x) - 1, Math.round(y) + 9, 3, 3);   // 모서리 기둥
}

function drawFlat(o) {
  const { x, y } = P(o.gx, o.gy);
  const pal = palette();
  X.save(); X.globalAlpha = 0.16; rhomb(X, x + 3, y + 2, 22, 11, '#000000'); X.restore();
  prism(X, x, y, 22, 11, 12, '#9C7A56', '#6B5136', '#8A6A4A');
  faces(X, x, y, 22, 11, 10, 12, '#B08A62', '#C9A272');           // 상판 테두리
  rhomb(X, x, y - 12, 18, 9, '#A98A63');
  for (let k = 0; k < 3; k++) {
    const c = pal[(o.gx + k) % pal.length];
    prism(X, x - 11 + k * 11, y - 12 + (k - 1) * 5, 6, 3, 8, shade(c, 0.25), shade(c, -0.25), c);
    isoWin(X, x - 11 + k * 11, y - 12 + (k - 1) * 5, 6, 3, 'r', 1, 2, 4, 4, shade(c, 0.40));
  }
}

function drawCounter() {
  for (const o of countersNow()) {
    const { x, y } = P(o.gx, o.gy);
    X.save(); X.globalAlpha = 0.18; rhomb(X, x + 3, y + 2, 22, 11, '#000000'); X.restore();
    prism(X, x, y, 22, 11, 21, '#7186AD', '#3E4A66', '#5A6B8C');
    faces(X, x, y, 22, 11, 0, 3, '#33405A', '#4A5B7B');           // 굽도리
    faces(X, x, y, 22, 11, 10, 12, '#8FA4CC', '#9DB2D8');         // 허리 몰딩
    faces(X, x, y, 22, 11, 21, 23, '#8FA4CC', '#9DB2D8');         // 상판
    isoWin(X, x, y, 22, 11, 'r', 6, 13, 12, 6, '#48597A');        // 앞면 패널
  }
  const a = P(COUNTER[0].gx, COUNTER[0].gy);
  X.fillStyle = '#20263A'; X.fillRect(Math.round(a.x) - 8, Math.round(a.y) - 39, 17, 12);   // POS
  X.fillStyle = '#8AB4D8'; X.fillRect(Math.round(a.x) - 6, Math.round(a.y) - 38, 14, 8);
  X.fillStyle = 'rgba(255,255,255,.35)'; X.fillRect(Math.round(a.x) - 6, Math.round(a.y) - 38, 14, 2);
  X.fillStyle = '#3E4A66'; X.fillRect(Math.round(a.x) - 4, Math.round(a.y) - 27, 9, 3);     // 받침
  if (fl('counter') >= 2) {                                    // 셀프 계산 단말 한 대 더
    const b = P(COUNTER[1].gx, COUNTER[1].gy);
    X.fillStyle = '#20263A'; X.fillRect(Math.round(b.x) - 8, Math.round(b.y) - 36, 17, 12);
    X.fillStyle = '#4ECDC4'; X.fillRect(Math.round(b.x) - 6, Math.round(b.y) - 35, 14, 8);
    X.fillStyle = 'rgba(255,255,255,.35)'; X.fillRect(Math.round(b.x) - 6, Math.round(b.y) - 35, 14, 2);
  }
  const c = P(CLERK.gx, CLERK.gy);
  drawPerson(c.x, c.y, clerk, 'w', 1);                                                     // 점원
  if (fl('counter')) {                                          // 2번대 점원
    const c2 = P(CLERK2.gx, CLERK2.gy);
    drawPerson(c2.x, c2.y, clerk2, 'w', 1);
  }
}

function drawProp(o) {
  const { x, y } = P(o.gx, o.gy);
  if (o.k === 'plant') {
    prism(X, x, y, 10, 5, 11, '#B96A3C', '#7A3E22', '#A0562F');
    faces(X, x, y, 10, 5, 9, 11, '#C9793F', '#D98A4C');          // 화분 테
    prism(X, x, y - 11, 14, 7, 14, '#3E8A56', '#245239', '#2F6B45');
    prism(X, x - 3, y - 22, 8, 4, 8, '#4E9A66', '#2C6243', '#3E8A56');
  } else if (o.k === 'carts') {
    for (let i = 0; i < 3; i++) {
      const cx = x - 6 + i * 6, cy = y - 3 + i * 3;
      prism(X, cx, cy, 10, 5, 14, '#C6CCE2', '#5E6478', '#9AA0B0');
      isoWin(X, cx, cy, 10, 5, 'r', 2, 4, 6, 8, '#8A90A4');      // 망
    }
  } else {
    X.fillStyle = '#59627E'; X.fillRect(Math.round(x), Math.round(y - 21), 2, 21);
    X.fillStyle = '#3E4763'; X.fillRect(Math.round(x) - 4, Math.round(y) - 2, 10, 3);      // 받침
    rrect(Math.round(x - 12), Math.round(y - 36), 27, 17, '#D0453B');
    X.fillStyle = shade('#D0453B', 0.28); X.fillRect(Math.round(x - 11), Math.round(y - 35), 25, 2);
    X.fillStyle = 'rgba(255,255,255,.78)';
    X.fillRect(Math.round(x - 9), Math.round(y - 32), 21, 3); X.fillRect(Math.round(x - 9), Math.round(y - 27), 14, 3);
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
  const extraOff = [{ gx: 13, gy: 9, k: 'cabinet' }, { gx: 10, gy: 5, k: 'plant' }, { gx: 12, gy: 9, k: 'copier' }]
    .slice(0, fl('office'));
  for (const o of extraOff) {
    const p = P(o.gx, o.gy);
    items.push({ y: p.y, f: () => drawOfficeProp(p, o.k) });
  }
  for (const o of [{ gx: 13, gy: 0, k: 'shelf' }, { gx: 15, gy: 2, k: 'sofa' }, { gx: 13, gy: 2, k: 'plant' },
                   { gx: 13, gy: 5, k: 'copier' }, { gx: 13, gy: 8, k: 'cooler' }, { gx: 15, gy: 9, k: 'cabinet' }, { gx: 10, gy: 9, k: 'plant' }]) {
    const p = P(o.gx, o.gy);
    items.push({ y: p.y, f: () => drawOfficeProp(p, o.k) });
  }
}

function drawEmptyChair(seat, d) {
  X.fillStyle = 'rgba(0,0,0,.20)'; rhomb(X, seat.x, seat.y, 12, 6, 'rgba(0,0,0,.20)');
  prism(X, seat.x, seat.y, 12, 6, 6, '#4C5673', '#2A3046', '#3E4763');
  X.fillStyle = '#3E4763'; X.fillRect(Math.round(seat.x) - 9, Math.round(seat.y) - 20, 18, 14);
  drawText(seat.x, seat.y - 27, '출장', { size: 10, color: '#8FBEEA' });
}

function drawDesk(p, on, i) {
  const { x, y } = p;
  X.save(); X.globalAlpha = 0.18; rhomb(X, x + 3, y + 2, 22, 11, '#000000'); X.restore();
  prism(X, x, y, 22, 11, 15, '#B08A62', '#6B5136', '#9C7A56');
  faces(X, x, y, 22, 11, 13, 15, '#C49A6E', '#D8B184');                                  // 상판 테두리
  isoWin(X, x, y, 22, 11, 'r', 6, 3, 12, 8, '#8A6A4A');                                  // 서랍
  isoWin(X, x, y, 22, 11, 'r', 6, 7, 12, 1, '#C9A272');
  X.fillStyle = '#8A8F9E'; X.fillRect(Math.round(x) - 10, Math.round(y) - 18, 3, 4);     // 모니터 목
  // 모니터는 책상 왼쪽에 둔다. 가운데에 두면 앉은 사람 얼굴을 가린다.
  rrect(Math.round(x) - 17, Math.round(y) - 30, 15, 12, '#20263A');
  X.fillStyle = on ? (Math.floor(frame / 40 + i) % 2 ? '#4ECDC4' : '#4A86C7') : '#2C3550';
  X.fillRect(Math.round(x) - 15, Math.round(y) - 29, 12, 9);
  X.fillStyle = 'rgba(255,255,255,.28)'; X.fillRect(Math.round(x) - 15, Math.round(y) - 29, 12, 2);
  X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x) - 12, Math.round(y) - 17, 11, 3);    // 키보드
  X.fillStyle = '#9AA0B0'; X.fillRect(Math.round(x) - 12, Math.round(y) - 17, 11, 1);
  X.fillStyle = '#F5EFDD'; X.fillRect(Math.round(x) + 3, Math.round(y) - 20, 11, 8);    // 서류
  X.fillStyle = '#D6D2C4'; X.fillRect(Math.round(x) + 3, Math.round(y) - 18, 11, 1);
  X.fillStyle = '#D0453B'; X.fillRect(Math.round(x) + 12, Math.round(y) - 20, 5, 6);    // 머그
  X.fillStyle = '#E8837B'; X.fillRect(Math.round(x) + 12, Math.round(y) - 20, 5, 2);
}

function drawBossDesk(p) {
  const { x, y } = p;
  X.save(); X.globalAlpha = 0.24; rhomb(X, x + 3, y + 2, 28, 14, '#000000'); X.restore();
  prism(X, x, y, 28, 14, 18, '#8A6A4A', '#4E3A24', '#6B5136');
  faces(X, x, y, 28, 14, 0, 3, '#3E2E1C', '#563F28');                                    // 굽도리
  faces(X, x, y, 28, 14, 18, 20, '#B08A62', '#C69A6E');
  isoWin(X, x, y, 28, 14, 'r', 8, 5, 14, 9, '#75573A');                                  // 서랍
  isoWin(X, x, y, 28, 14, 'r', 8, 9, 14, 1, '#C69A6E');
  rrect(Math.round(x) - 21, Math.round(y) - 36, 15, 12, '#20263A');
  X.fillStyle = '#4ECDC4'; X.fillRect(Math.round(x) - 20, Math.round(y) - 35, 12, 9);
  X.fillStyle = 'rgba(255,255,255,.28)'; X.fillRect(Math.round(x) - 20, Math.round(y) - 35, 12, 2);
  X.fillStyle = '#F2B233'; X.fillRect(Math.round(x) + 6, Math.round(y) - 24, 9, 6);    // 명패
  X.fillStyle = '#F5EFDD'; X.fillRect(Math.round(x) - 5, Math.round(y) - 23, 12, 8);
  drawText(x, y - 45, '사장실', { size: 10, color: '#FFD57A' });
  /* 오늘 결재가 남아 있으면 눌러야 할 곳임을 알린다 */
  if ((S.co.deskDay || 0) !== S.day) {
    const p = 0.55 + Math.sin(frame / 16) * 0.25;
    X.save(); X.globalAlpha = p;
    X.fillStyle = '#F2B233'; X.fillRect(Math.round(x) - 15, Math.round(y) - 66, 30, 14);
    X.restore();
    drawText(x, y - 56, '결재', { size: 10, color: '#20263A', shadow: false });
  }
}

function drawOfficeProp(p, k) {
  const { x, y } = p;
  if (k === 'plant') {
    prism(X, x, y, 10, 5, 11, '#B96A3C', '#7A3E22', '#A0562F');
    prism(X, x, y - 11, 14, 7, 14, '#3E8A56', '#245239', '#2F6B45');
  } else if (k === 'cooler') {
    prism(X, x, y, 10, 5, 18, '#DDE3F0', '#7A8090', '#C6CCE2');
    prism(X, x, y - 18, 10, 5, 12, '#A8CCE4', '#5E7E96', '#8AB4D8');
  } else if (k === 'copier') {
    prism(X, x, y, 16, 8, 21, '#A6ACBC', '#5E6478', '#8A8F9E');
    X.fillStyle = '#20263A'; X.fillRect(Math.round(x) - 9, Math.round(y) - 18, 18, 5);
    X.fillStyle = '#2FA37A'; X.fillRect(Math.round(x) + 6, Math.round(y) - 26, 5, 3);
  } else if (k === 'cabinet') {
    prism(X, x, y, 16, 8, 33, '#A6ACBC', '#5E6478', '#8A8F9E');
    faces(X, x, y, 16, 8, 31, 33, '#C0C6D4', '#D2D8E4');
    for (let i = 0; i < 3; i++) {                                  // 서랍 + 손잡이
      isoWin(X, x, y, 16, 8, 'r', 5, 5 + i * 9, 9, 6, '#6E7488');
      isoWin(X, x, y, 16, 8, 'r', 7, 7 + i * 9, 4, 1, '#C6CCE2');
    }
  } else if (k === 'sofa') {
    prism(X, x, y, 20, 10, 9, '#5A6B8C', '#2E3A52', '#46567A');
    faces(X, x, y, 20, 10, 7, 9, '#6C7EA0', '#7E90B4');            // 방석 선
    X.fillStyle = '#46567A'; X.fillRect(Math.round(x) - 17, Math.round(y) - 21, 17, 14);
    X.fillStyle = '#5A6B8C'; X.fillRect(Math.round(x) - 17, Math.round(y) - 21, 17, 3);
  } else {
    prism(X, x, y, 16, 8, 30, '#8A6A4A', '#4E3A24', '#6B5136');
    const pal = ['#D0453B', '#4A86C7', '#2FA37A', '#F2B233'];
    for (let r = 0; r < 2; r++) faces(X, x, y, 16, 8, 7 + r * 11, 9 + r * 11, '#5C4630', '#7A5C40');
    for (let i = 0; i < 3; i++) {                                  // 책등
      isoWin(X, x, y, 16, 8, 'r', 5 + i * 8, 9, 6, 12, pal[i % 4]);
      isoWin(X, x, y, 16, 8, 'r', 5 + i * 8, 19, 6, 1, shade(pal[i % 4], 0.3));
    }
  }
}

/* ── 하단 상태 스트립 ────────────────────────────────────── */
function drawFoot() {
  X.fillStyle = '#14182A'; X.fillRect(0, FOOT_Y, STORE_W, STORE_H - FOOT_Y);
  X.fillStyle = '#39415F'; X.fillRect(0, FOOT_Y, STORE_W, 2);
  const net = S.co.revToday - S.co.costToday;
  const cells = [
    ['일매출', won(S.co.revToday), '#FFD57A'],
    ['순익', (net >= 0 ? '+' : '') + won(net), net >= 0 ? '#4BD69B' : '#F07068'],
    ['인지도', '×' + S.co.marketing.toFixed(2), '#8FBEEA'],
    ['재고', Math.round(S.co.inv ?? 100) + '%', (S.co.inv ?? 100) < 25 ? '#F07068' : (S.co.inv ?? 100) < 60 ? '#FFD57A' : '#4BD69B'],
    ['손님', customers.length + '명', '#E3D8BB'],
    ['직원', S.staff.length + '명', '#E3D8BB'],
  ];
  const cw = STORE_W / cells.length;
  cells.forEach(([k, v, c], i) => {
    if (i) { X.fillStyle = '#2A3046'; X.fillRect(i * cw, FOOT_Y + 5, 2, 15); }
    drawText(i * cw + cw / 2, FOOT_Y + 18, `${k} ${v}`, { size: 10, color: c, shadow: false });
  });
}

export { glassPanel, BOSS, CLERK, CLERK2, COUNTER, DESKS, DOOR, EXTRA_COUNTER, EXTRA_FRIDGE, EXTRA_SHELF, FLATS, FREEZERS, FRIDGES, HOTSPOTS, P, QUEUE, SHELVES, SHOP_BLOCK, SHOP_PROPS, SPAWN_GX, addOffice, advancePhase, bar, blockedAt, countersNow, drawBossDesk, drawCounter, drawDesk, drawEmptyChair, drawFlat, drawFoot, drawFreezer, drawFridge, drawOfficeProp, drawPartition, drawProp, drawShelf, drawSignboard, drawStore, drawWalls, drawWhiteboard, facilKey, findPath, fl, fridgesNow, inBossRoom, invRatio, newCustomer, offFloorPal, palette, retarget, shelvesNow, shopFloorPal, spawnCustomers, stepCustomers, stocked, storeFloor, storeHit, tileOf, walkable };
