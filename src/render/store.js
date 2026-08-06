import { SECTORS, SHOP_ZONES, TIERS, gradeOf } from '../core/data.js';
import { S } from '../core/state.js';
import { viewRand } from '../core/rng.js';
import { $, clamp, vpick, vrint, vrnd, won } from '../core/util.js';
import { HH, HW, faces, isoRoof, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge } from './iso.js';
import { shopOf } from '../core/derive.js';
import { footY, ROOM_W, roomH, SPLIT_GX, storeH, storeO, storeW, X, bubbleTurn, customers, drawBubble, drawPerson, drawPops, drawSitter, drawText, faceOf, frame, mix, newLook, pops, rrect, shade } from './canvas.js';
import { dailyRetail, productLines, shopZones } from '../systems/economy.js';

/* ══════════════════════════════════════════════════════════════
   사옥 (경영, 쿼터뷰) — 좌 매장 / 우 사무실 + 사장실

   기획서 5장의 "고객 NPC가 물건을 사는 매장(아이러브커피) + 한쪽에 사무실
   (게임 개발 스토리, 월간 아이돌)" 구성.

   16×10 타일. gx 0..8 매장 / 9 칸막이 / 10..15 사무실.
   손님은 타일 격자 위에서 길을 찾으므로 집기를 뚫고 지나가지 않는다.
   ══════════════════════════════════════════════════════════════ */

const DOOR = { gx: 0, gy: 7 };          // 매장 서쪽 자동문
const STREET_GX = -3;                   // 인도 (gx -3, -2 두 열)
const STREET_MIN = -9;                  // 인도에서 오갈 수 있는 위쪽 끝
/* 함수다 — canvas.js 와 서로 물려 있어 최상위에서 roomH() 를 읽으면 초기화 전이다 */
const streetMax = () => roomH() + 8;     //                   아래쪽 끝

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
/* 4·5단계는 **넓힌 방에만** 자리가 있다 (gy 10, 11). 가게 확장 없이는 살 수 없다
   — facilMax 가 막는다. '넓혔더니 놓을 데가 생겼다' 가 확장의 값어치다. */
const EXTRA_SHELF   = [{ gx: 1, gy: 1 }, { gx: 2, gy: 1 }, { gx: 3, gy: 1 },
                       { gx: 1, gy: 10 }, { gx: 3, gy: 10 }];
const EXTRA_FRIDGE  = [{ gx: 7, gy: 0 }, { gx: 7, gy: 1 }, { gx: 4, gy: 1 },
                       { gx: 5, gy: 1 }, { gx: 6, gy: 1 }];   // 냉장 설비
/* 계산대 증설 — **단계마다 한 대씩** 늘어난다. 예전에는 목록이 한 칸뿐이라
   1단계든 3단계든 화면이 똑같았다. 돈을 냈는데 아무것도 안 달라지면
   증설한 걸 스스로 알 수 없다. 점원도 대수만큼 선다. */
const EXTRA_COUNTER = [{ gx: 7, gy: 4 }, { gx: 7, gy: 6 }, { gx: 7, gy: 7 }];
const EXTRA_CLERK   = [{ gx: 8, gy: 4 }, { gx: 8, gy: 6 }, { gx: 8, gy: 7 }];
const CLERK2 = EXTRA_CLERK[0];

const fl = k => (S.co.facil && S.co.facil[k]) || 0;

/** 지금 레벨에서 실제로 깔린 집기 목록 */
function shelvesNow() { return SHELVES.concat(EXTRA_SHELF.slice(0, fl('shelf'))); }

function fridgesNow() { return FRIDGES.concat(EXTRA_FRIDGE.slice(0, fl('cold'))); }

function countersNow() { return COUNTER.concat(EXTRA_COUNTER.slice(0, fl('counter'))); }

/** 지금 서 있는 추가 점원 자리 */
function clerksNow() { return EXTRA_CLERK.slice(0, fl('counter')); }

/** 충돌 판정 — 기본 집기 + 증설분 */
function blockedAt(gx, gy) {
  if (SHOP_BLOCK.has(`${gx},${gy}`)) return true;
  const ex = [...EXTRA_SHELF.slice(0, fl('shelf')), ...EXTRA_FRIDGE.slice(0, fl('cold'))];
  ex.push(...EXTRA_COUNTER.slice(0, fl('counter')), ...clerksNow());
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
function facilKey() { return ['shelf', 'counter', 'cold', 'office'].map(fl).join('') + ':' + S.co.tier; }

function P(gx, gy) { const O = storeO(); return { x: isoX(O, gx, gy), y: isoY(O, gx, gy) }; }

/* ── 바닥 캐시 ───────────────────────────────────────────── */
function storeFloor() {
  const key = facilKey();
  if (floorLayer && floorFor === S && floorKey === key) return floorLayer;
  floorFor = S; floorKey = key;
  clerk = clerk || newLook('#F2B233');
  clerk2 = clerk2 || newLook('#E8E4D8');
  boss = boss || newLook('#8B5CB8');
  const layer = makeLayer(storeW(), storeH());
  const g = layer.ctx;
  if (g) {
    for (let gy = 0; gy < roomH(); gy++) for (let gx = 0; gx < ROOM_W; gx++) {
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
/* 바닥 마감은 **등급**을 따른다. 시설 합계로 정하면 돈만 부으면 대리석이 깔려
   "회사가 커져서 좋아진 것" 으로 안 읽힌다. 나무 → 타일 → 석재 → 대리석. */
const FLOOR_GRADE = [
  [FLOOR_SHOP, FLOOR_SHOP2],
  ['#D6CBAE', '#C6B996'],
  ['#DCD6C6', '#CCC5B2'],
  ['#E8E4DA', '#D8D3C6'],
];
function shopFloorPal() { return FLOOR_GRADE[gradeOf(S).floor]; }

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
  /* 처음 몇은 **매장 안에서** 시작한다. 전부 길에서 걸어 들어오게 하면 탭을
     연 순간 가게가 텅 비어 있고, 사람이 차기까지 십수 초가 걸린다.
     들어오는 그림은 그 뒤로 계속 채워지는 손님들이 만든다. */
  for (let i = 0; i < 6; i++) {
    const c = newCustomer();
    const t = vpick(shelvesNow());
    const p = P(t.gx, t.gy + 1);
    c.x = p.x; c.y = p.y; c.wait = vrint(0, 40); c.path = [];
    customers.push(c);
  }
}

function newCustomer() {
  const sp = streetSpot();          // 길에서 나타나 문까지 걸어온다
  const p = P(sp.gx, sp.gy);
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
  /* 문 밖은 **인도 두 열이 세로로 길게** 열려 있다. 예전에는 문 앞 한 줄만
     통행 가능해서, 손님이 갈 수 있는 곳이 그 자리뿐이었고 그래서 걸어오는 게
     아니라 소환되는 것처럼 보였다. 인도를 열어 두면 길찾기가 알아서
     "인도를 따라 오다가 문 앞에서 꺾어 들어온다" 를 만든다. */
  if (gx < 0) {
    if (gx === -1) return gy === DOOR.gy;                       // 자동문 한 칸
    return gx >= STREET_GX && gy >= STREET_MIN && gy <= streetMax();
  }
  if (gx > SPLIT_GX - 1 || gy < 0 || gy > roomH() - 1) return false;
  return !blockedAt(gx, gy);
}

/**
 * 인도 위의 지점. 들어올 때와 나갈 때의 출발·도착지다.
 *
 * **문 근처로 잡는다.** 인도 전체(-9 ~ roomH+8)에서 아무 데나 고르면, 손님이
 * 많아질수록 오가는 시간이 길어져 밖에 사람이 고인다 — 등급 손님을 24명으로
 * 올렸더니 스무 명이 길에 줄을 선 그림이 나왔다. 걸어 들어오는 맛은 살리되
 * 왕복이 짧아야 사람이 매장 안에 있는다.
 */
function streetSpot() {
  const near = vrint(-3, 3);
  return { gx: viewRand() < 0.5 ? STREET_GX : STREET_GX + 1,
           gy: clamp(DOOR.gy + near, STREET_MIN, streetMax()) };
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
  const O = storeO();
  const dx = (p.x - O.x) / HW, dy = (p.y - O.y) / HH;
  return { gx: Math.round((dy + dx) / 2), gy: Math.round((dy - dx) / 2) };
}

function retarget(p) {
  const from = tileOf(p);
  let to;
  if (p.phase === 'shelf') {
    /* 진열대 앞자리는 남쪽 한 칸으로 고정돼 있었다. 방 남쪽 끝에 진열대가
       놓이면 그 자리가 방 밖이라 길찾기가 통째로 실패한다 — 통행 가능한
       이웃 중 아무 데나로 바꾼다. */
    const sh = vpick(shelvesNow());
    to = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ gx: sh.gx + dx, gy: sh.gy + dy }))
      .find(t => walkable(t.gx, t.gy)) || { gx: 5, gy: 5 };
  }
  else if (p.phase === 'counter') to = { gx: QUEUE.gx, gy: QUEUE.gy + (viewRand() < 0.5 ? 0 : 1) };
  else to = streetSpot();          // 나갈 때도 길을 따라 멀어진다
  if (!walkable(to.gx, to.gy)) to = { gx: 5, gy: 5 };
  p.path = findPath(from, to);
}

/* 손님 대사. 진열대 앞에서는 **실제로 매장에 오른 상품**을 부른다 —
   제약 계열사를 사면 손님이 비타민을 찾기 시작한다. 인수의 성과가 매장 화면에
   드러나는 몇 안 되는 자리다. 상품군이 없으면(계열사 0) 일반 대사로 돌아간다. */
const SAY_SHOP = ['이것도 담을까', '어느 게 낫지', '오늘 세일인가', '찾았다!'];
const SAY_PAY = ['이거 주세요', '봉투 하나요', '카드로 할게요', '포인트 적립돼요?'];

function sayShop(i) {
  const lines = productLines(S);
  if (!lines.length) return SAY_SHOP[i % SAY_SHOP.length];
  const g = SECTORS[lines[i % lines.length]].goods;
  const item = g[(i * 3) % g.length];
  return [`${item} 어디 있죠?`, `${item} 하나 담자`, `${item} 좀 볼까`][i % 3];
}

function stepCustomers(items) {
  /* 손님 수. 등급이 오르면 가게가 커지고 사람도 늘어야 한다 — 넓어진 매장에
     같은 인원이 서 있으면 오히려 썰렁해 보인다. 상한도 같이 올린다. */
  /* 등급이 손님 수를 정한다. **crowd 가 하한이자 기준**이고, 인지도와 계열사가
     그 위로 얹힌다. 하한을 둔 이유는 초반에 마케팅이 0 이어도 가게가 비면
     안 되기 때문이고, 상한을 둔 이유는 넓어진 매장 대비 인원이 그림을 정한다는
     것뿐 아니라 이 배열이 매 프레임 경로를 도는 비용이기 때문이다. */
  const g = gradeOf(S);
  const want = clamp(Math.round(g.crowd * 0.7) + Math.round(S.co.marketing * 4) + S.co.subs.length,
                     Math.round(g.crowd * 0.7), g.crowd);
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
    const px = p.x, py = p.y, look = p.look, dir = p.dir, ph2 = p.phase;
    const ph = p.wait > 0 ? 1 : Math.floor(p.walk / 8);
    const i = customers.indexOf(p);
    items.push({ y: py, f: () => {
      drawPerson(px, py, look, dir, ph);
      /* 멈춰 선 손님만 말한다 — 걸어가면서 띄우면 풍선이 화면을 가로지른다.
         진열대 앞과 계산대 앞의 대사가 달라야 "뭘 하는 중"인지가 읽힌다. */
      if (p.wait > 0 && bubbleTurn(i, 300, 150)) {
        drawBubble(px, py - 34, ph2 === 'counter' ? SAY_PAY[i % SAY_PAY.length] : sayShop(i));
      }
    } });
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
/* ══════════════════════════════════════════════════════════════
   문 밖 거리

   손님은 인도(gx -3, -2)의 아무 지점에서 나타나 길을 따라 걸어와 문으로 꺾는다.
   나갈 때도 길을 따라 멀어진다. 예전에는 문 앞 한 칸만 통행 가능해서 갈 수 있는
   곳이 그 자리뿐이었고, 그래서 걸어오는 게 아니라 **소환되는 것처럼** 보였다.


   배경도 단색 남색을 걷어내고 하늘 + 건너편 건물 실루엣으로 바꾼다. 흐릿하게
   뒤에 깔리는 것이라 디테일이 필요 없다 — 도트를 안 찍고도 되는 영역이다.
   ══════════════════════════════════════════════════════════════ */
/* 지평선. 하늘과 땅의 경계이자 **문 밖 거리를 잘라 내는 선**이다.
   거리 타일은 gx -30 까지 뻗는데, 그대로 두면 화면 좌상단에서 하늘 위로
   길이 솟아오른다. 배경과 거리가 같은 값을 봐야 어긋나지 않는다.

   상수가 아니라 함수다 — store.js 와 canvas.js 가 서로 물려 있어 모듈 최상위에서
   storeH() 를 읽으면 아직 초기화 전이라 터진다. */
/* 값이 방의 북쪽 꼭짓점(y=72)보다 조금 위다. 쿼터뷰에는 원래 지평선이 없지만,
   화면 위쪽에 남는 좁은 띠를 하늘로 쓰고 그 아래를 전부 땅으로 채우면
   "길 옆에 매장이 서 있다"로 읽힌다. 이 값을 내리면 문 밖 거리가 통째로
   잘려 나가고(직접 겪었다), 올리면 원경 건물이 화면 밖으로 밀린다. */
const horizonY = () => 44;

function drawBackdrop() {
  /* **하늘을 그리지 않는다.** 쿼터뷰에는 지평선이 없다. 억지로 평면 스카이라인을
     얹었더니 두 가지가 깨졌다 — 투영이 달라 뒤에 붙인 배경지처럼 보였고,
     지평선이 도로를 가로질러 잘라 **톱니 모양 가장자리**를 만들었다.

     화면 좌상단은 타일 좌표로 gx≈-12, gy≈5 근처다. 즉 거기는 하늘이 아니라
     **길 건너 블록**이 있어야 할 자리다. 땅으로 전부 덮고 그 위에 아이소 건물을
     세우면 도로 끝은 건물이 알아서 가린다 — 자를 필요가 없어진다. */
  const M = 900;
  X.fillStyle = '#9BA2B4'; X.fillRect(-M, -M, storeW() + M * 2, storeH() + M * 2);
}

/* 길 건너 블록. 평면 띠가 아니라 **같은 투영의 아이소 건물**이라야 배경이
   장면의 일부로 읽힌다. 한 채가 3×3 타일이다. */
const FAR_BODY = ['#B9C2D0', '#C6CCD8', '#AEB7C6', '#CAD0DA', '#B2BAC8'];
const FAR_ROOF = ['#8E97A8', '#9AA2B2', '#848DA0', '#9EA6B4', '#8A93A4'];

function drawFarBuilding(gx, gy, k) {
  const a = P(gx, gy), b = P(gx + 2, gy + 2);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const h = 40 + k * 17;
  const body = FAR_BODY[k], roof = FAR_ROOF[k];
  X.save(); X.globalAlpha = 0.12; rhomb(X, cx + 4, cy + 2, HW * 3, HH * 3, '#000000'); X.restore();
  prism(X, cx, cy, HW * 3, HH * 3, h, roof, shade(body, -0.26), body);
  for (let up = 10; up < h - 10; up += 13) {          // 창문 줄
    for (let off = 8; off < HW * 3 - 8; off += 14) {
      isoWin(X, cx, cy, HW * 3, HH * 3, 'r', off, up, 8, 7, 'rgba(120,140,166,.42)');
      isoWin(X, cx, cy, HW * 3, HH * 3, 'l', off, up, 8, 7, 'rgba(104,122,148,.42)');
    }
  }
  faces(X, cx, cy, HW * 3, HH * 3, h - 4, h, shade(body, -0.34), shade(body, -0.14));   // 처마
}

/** 매장 서쪽 — 인도와 차도. 손님이 여기서 걸어 들어온다 */
function drawOutside() {
  /* 범위를 방보다 훨씬 넓게 잡아 **거리의 끝이 화면 밖으로 나가게** 한다.
     방 크기에 맞춰 자르면 길이 허공에서 뚝 끊겨, 톱니 모양 가장자리를 가진
     판때기가 떠 있는 것처럼 보인다. 화면 밖 타일은 그리기 전에 걸러내므로
     범위를 넓게 잡아도 비용은 늘지 않는다.

     차도 하나만 깔면 길이 아니라 회색 띠다. **건너편 인도까지** 놓아야
     "길 건너에서 이쪽으로 온다"로 읽힌다. */
  for (let gy = -26; gy < roomH() + 28; gy++) {
    for (let gx = -30; gx < -1; gx++) {
      const { x, y } = P(gx, gy);
      if (x < -240 || x > storeW() + 240 || y < -60 || y > storeH() + 60) continue;
      if (gx >= -3) {                                    // 이쪽 인도
        rhomb(X, x, y, HW, HH, ((gx + gy) & 1) ? '#C6CBD8' : '#BEC3D0');
        rhombEdge(X, x, y, HW, HH, '#AFB6C6');
      } else if (gx >= -7) {                             // 차도
        /* 인도와 명도가 붙어 있으면 길이 아니라 회색 판이다. 아스팔트를 확실히
           어둡게 깔고, 그 위에 얼룩과 차선을 얹어야 노면으로 읽힌다. */
        rhomb(X, x, y, HW, HH, gx === -4 || gx === -7 ? '#767C90' : '#6B7185');
        X.fillStyle = 'rgba(255,255,255,.05)';           // 노면 얼룩
        X.fillRect(Math.round(x - 10 + ((gy * 7) % 16)), Math.round(y - 3 + ((gx * 5) % 6)), 4, 2);
        if (gx === -6 && ((gy % 3) + 3) % 3 === 0) {
          X.fillStyle = 'rgba(255,248,214,.78)';         // 중앙선
          X.fillRect(Math.round(x - 4), Math.round(y - 1), 9, 2);
        }
        if (gy === DOOR.gy + 1 || gy === DOOR.gy + 2) {  // 문 앞 횡단보도
          X.fillStyle = 'rgba(255,255,255,.62)';
          for (let i = -10; i <= 10; i += 7) X.fillRect(Math.round(x + i), Math.round(y - 5 - i / 2), 5, 5);
        }
      } else if (gx >= -9) {                             // 건너편 인도
        rhomb(X, x, y, HW, HH, ((gx + gy) & 1) ? '#BAC0CE' : '#B2B8C6');
        rhombEdge(X, x, y, HW, HH, '#A4AABA');
      } else {                                            // 건너편 건물 그늘
        rhomb(X, x, y, HW, HH, '#8A90A4');
      }
    }
    if (gy === DOOR.gy) {
      const { x, y } = P(-2, gy);
      rhomb(X, x, y, HW, HH, '#C7A97E');                 // 문 앞 매트
    }
  }
  /* 연석 — 차도와 인도의 단차. 평면감을 줄이는 데 이게 제일 크다 */
  for (let gy = -10; gy < roomH() + 12; gy++) {
    const { x, y } = P(-4, gy);
    if (y < -40 || y > storeH() + 20) continue;
    X.fillStyle = '#DDE1EA'; X.fillRect(Math.round(x - HW), Math.round(y - 3), HW * 2, 2);   // 연석 윗면
    X.fillStyle = '#8C93A6'; X.fillRect(Math.round(x - HW), Math.round(y - 1), HW * 2, 2);
  }
  /* 가로등 두 개 — 거리라는 신호 */
  for (const gy of [-3, 3, roomH(), roomH() + 6]) {
    const { x, y } = P(-3, gy);
    X.save(); X.globalAlpha = 0.18; rhomb(X, x + 1, y + 1, 5, 3, '#000000'); X.restore();
    X.fillStyle = '#78809A'; X.fillRect(Math.round(x) - 1, Math.round(y) - 26, 2, 26);
    X.fillStyle = '#C9CEDC'; X.fillRect(Math.round(x) - 3, Math.round(y) - 30, 6, 5);
  }

  /* 길 건너 블록. 뒤(gx+gy 가 작은 쪽)부터 그려야 서로 안 겹친다. */
  const far = [];
  for (let gy = -24; gy < roomH() + 24; gy += 3) far.push([-12, gy]);   // 길 건너 줄
  for (let gx = -33; gx <= -15; gx += 3) far.push([gx, -6]);           // 길 끝을 막는 줄
  far.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  for (const [gx, gy] of far) {
    const c = P(gx + 1, gy + 1);
    if (c.x < -300 || c.x > storeW() + 300 || c.y < -220 || c.y > storeH() + 120) continue;
    drawFarBuilding(gx, gy, (((gx * 7 + gy * 13) % 5) + 5) % 5);
  }
}

function drawStore() {
  drawBackdrop();
  drawOutside();
  const f = storeFloor();
  if (f && f.c) X.drawImage(f.c, 0, 0);

  const items = [];
  drawWalls(items);
  for (const o of fridgesNow()) items.push({ y: P(o.gx, o.gy).y, f: () => drawFridge(o) });
  for (const o of FREEZERS) items.push({ y: P(o.gx, o.gy).y, f: () => drawFreezer(o) });
  for (const o of shelvesNow()) items.push({ y: P(o.gx, o.gy).y, f: () => drawShelf(o) });
  for (const o of FLATS) items.push({ y: P(o.gx, o.gy).y, f: () => drawFlat(o) });
  for (const o of SHOP_PROPS) items.push({ y: P(o.gx, o.gy).y, f: () => drawProp(o) });
  items.push({ y: P(COUNTER[1].gx, COUNTER[1].gy).y, f: drawCounter });
  addOffice(items);
  addWindows(items);
  addShopStaff(items);
  addDeco(items);
  drawPartition(items);
  stepCustomers(items);

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.f();
  drawWallFittings();

  drawPops();
  drawFoot();
}

/* 뒤쪽 두 면만 세운 컷어웨이. 앞쪽은 터야 안이 보인다. */
/**
 * 벽. **깊이 정렬 목록에 넣는다** — 통째로 먼저 그리면 문 밖에서 걸어 들어오는
 * 손님이 벽보다 뒤(북서)에 있는데도 벽 위에 겹쳐 그려져, 사람이 벽을 뚫고
 * 서 있는 것처럼 보인다. 벽 타일도 다른 사물과 같은 y 규칙으로 정렬해야 한다.
 */
function drawWalls(items) {
  /* 벽은 통짜 상자였다. 걸레받이와 허리 몰딩을 넣어 높이를 읽히게 한다. */
  for (let gx = 0; gx < ROOM_W; gx++) {                 // 북동쪽 벽 (gy = -1)
    const { x, y } = P(gx, -1);
    const shop = gx < SPLIT_GX;
    items.push({ y, f: () => {
      prism(X, x, y, HW, HH, 51, shop ? '#7D6B53' : '#585140', shop ? '#5C4E3C' : '#3E3A2C', shop ? '#6B5B47' : '#4A4436');
      faces(X, x, y, HW, HH, 0, 5, shop ? '#4A3E2E' : '#332F24', shop ? '#584A38' : '#3C3829');    // 걸레받이
      faces(X, x, y, HW, HH, 22, 24, shop ? '#6B5B47' : '#4A4436', shop ? '#8A7659' : '#635944');  // 허리 몰딩
    } });
  }
  for (let gy = -1; gy < roomH(); gy++) {                // 북서쪽 벽 (gx = -1)
    if (gy === DOOR.gy) continue;                        // 자동문 자리
    const { x, y } = P(-1, gy);
    items.push({ y, f: () => {
      prism(X, x, y, HW, HH, 51, '#6E5E48', '#5C4E3C', '#4A3E30');
      faces(X, x, y, HW, HH, 0, 5, '#443A2C', '#3A3025');
      faces(X, x, y, HW, HH, 22, 24, '#6B5B47', '#584A38');
    } });
  }
  const d = P(-1, DOOR.gy);                              // 유리 자동문
  items.push({ y: d.y, f: () => {
    prism(X, d.x, d.y, HW, HH, 51, '#9AB8D0', '#5C4E3C', '#8AB4D8');
    faces(X, d.x, d.y, HW, HH, 0, 5, '#443A2C', '#3A3025');
    glassPanel(d.x, d.y, HW, HH, 'r', 4, 6, 8, 32, '#A8C8DC');     // 두 짝으로 나뉜 유리
    glassPanel(d.x, d.y, HW, HH, 'r', 14, 6, 8, 32, '#A8C8DC');
    faces(X, d.x, d.y, HW, HH, 42, 45, '#6B5B47', '#8A7659');      // 상부 문틀
  } });

}

/**
 * 벽 부착물. **정렬 목록에 넣으면 안 된다.**
 * 간판은 벽 네 칸(gx 1~4)에 걸쳐 있는데 정렬 키는 한 칸의 y 하나뿐이라,
 * 더 큰 gx 의 벽 타일이 나중에 그려지면서 글자를 덮어 버렸다 — 회사 이름이
 * 안 보이던 원인이다. 벽보다 항상 앞이고 사람 머리 위에 붙어 있으므로
 * 정렬에서 빼고 마지막에 한 번 그리는 게 맞다.
 */
function drawWallFittings() {
  drawSignboard();
  drawWhiteboard();
  drawLights();
}

/* ══════════════════════════════════════════════════════════════
   등급 장식

   기능(진열대 대수)은 플레이어가 사고, **겉모습은 등급이 자동으로** 올린다.
   여기까지 돈을 받으면 등급이 오른 보람이 안 난다.
   한 등급에 하나씩만 붙는다 — 두 계단을 한 번에 오르면 "차근차근" 이 깨진다.
   ══════════════════════════════════════════════════════════════ */

/** 천장 조명. 매대 위에 매달린 펜던트 — 위쪽이라 무엇도 가리지 않는다 */
function drawLights() {
  const n = gradeOf(S).light;
  const spots = [{ gx: 2, gy: 4 }, { gx: 5, gy: 4 }, { gx: 2, gy: 7 }];
  /* 바닥에 깔리는 광원. **이게 없으면 조명이 안 보인다** — 펜던트만 그렸을 때는
     벽과 집기에 묻혀 켜졌는지도 알 수 없었다. 빛이 닿은 자리가 밝아져야
     "조명이 늘었다" 가 읽힌다. */
  for (const o of spots.slice(0, n)) {
    const { x, y } = P(o.gx, o.gy);
    X.save(); X.globalAlpha = 0.16; 
    rhomb(X, x, y + 4, HW * 2.1, HH * 2.1, '#FFE9A8');
    X.globalAlpha = 0.10; rhomb(X, x, y + 4, HW * 3.2, HH * 3.2, '#FFE9A8');
    X.restore();
  }
  for (const o of spots.slice(0, n)) {
    const { x, y } = P(o.gx, o.gy);
    const cx = Math.round(x), top = Math.round(y) - 74;
    X.fillStyle = '#3E3830'; X.fillRect(cx, top, 2, 14);              // 줄
    X.fillStyle = '#2E2A24'; X.fillRect(cx - 11, top + 14, 23, 5);    // 갓
    X.fillStyle = '#5C5346'; X.fillRect(cx - 11, top + 14, 23, 2);
    X.fillStyle = '#FFF0C4'; X.fillRect(cx - 8, top + 19, 17, 3);     // 전구면
    X.save(); X.globalAlpha = 0.13; X.fillStyle = '#FFE9A8';          // 빛 번짐
    X.fillRect(cx - 15, top + 22, 31, 12);
    X.globalAlpha = 0.07; X.fillRect(cx - 21, top + 22, 43, 26); X.restore();
  }
}

/**
 * 벽에 난 창. **거리 쪽 벽(gx = -1)에 낸다** — 북쪽 벽은 냉장고와 진열대가
 * 붙어 있어 창을 내도 집기 뒤에 가린다(처음에 그렇게 만들었다가 되돌렸다).
 * 거리 쪽이면 밖의 하늘과 지나가는 사람이 비쳐 실내가 답답해 보이지 않는다.
 */
function addWindows(items) {
  const n = gradeOf(S).win;
  const spots = [2, 4, 9, 10];
  for (const gy of spots.slice(0, n)) {
    if (gy >= roomH() || gy === DOOR.gy) continue;
    const { x, y } = P(-1, gy);
    items.push({ y: y + 0.4, f: () => {
      glassPanel(x, y, HW, HH, 'r', 3, 24, 18, 18, '#B4D2E6');
      X.fillStyle = '#6B5B47';                                  // 창틀 가로대
      const m = P(-1, gy);
      X.fillRect(Math.round(m.x) + 4, Math.round(m.y) - 34, 14, 2);
    } });
  }
}

/**
 * 매장 근무 직원. **배치하면 실제로 매장에 선다** — 숫자만 오르고 화면이
 * 그대로면 어디에 세웠는지 확인할 길이 없다. 진열대 옆과 계산대 뒤에 붙는다.
 */
function addShopStaff(items) {
  const spots = [{ gx: 4, gy: 3 }, { gx: 4, gy: 6 }, { gx: 6, gy: 4 },
                 { gx: 0, gy: 4 }, { gx: 4, gy: 9 }, { gx: 0, gy: 1 }];
  shopOf(S).slice(0, spots.length).forEach((e, i) => {
    const o = spots[i];
    if (o.gy >= roomH()) return;
    const { x, y } = P(o.gx, o.gy);
    if (!e.look) e.look = newLook(e.trait.id === 'star' ? '#F2B233' : null);
    items.push({ y, f: () => drawPerson(x, y, e.look, i % 2 ? 'e' : 's', Math.floor(frame / 34 + i) % 2) });
  });
}

/** 입구 러그와 화분. 사람이 오가는 자리를 피해 벽 쪽에만 둔다 */
function addDeco(items) {
  const g = gradeOf(S);
  if (g.rug) {
    const { x, y } = P(0, roomH() - 2);
    items.push({ y: y - 0.5, f: () => {
      rhomb(X, x, y, HW - 2, HH - 1, '#8C5A4A');
      rhomb(X, x, y, HW - 7, HH - 4, '#A66E58');
    } });
  }
  /* 통로 한가운데는 피한다 — 손님이 화분을 통과해 걸어가면 없느니만 못하다.
     매대와 벽 사이 자투리에만 둔다. */
  const spots = [{ gx: 4, gy: 2 }, { gx: 4, gy: 5 }, { gx: 4, gy: 8 }];
  for (const o of spots.slice(0, g.deco)) {
    if (o.gy >= roomH()) continue;
    const { x, y } = P(o.gx, o.gy);
    items.push({ y, f: () => drawProp({ gx: o.gx, gy: o.gy, k: 'plant' }) });
  }
}

/** 매장 간판 — 북동쪽 벽 위에 얹는다 */
/**
 * 회사 명판. **벽에 걸린 것처럼** 보여야 한다.
 *
 * 예전에는 남색 상자가 벽 **위로 떠 있었다**(y-54, 벽 높이는 51). 벽과 색도 재질도
 * 무관해서 화면에 붙인 딱지처럼 보였다. 세 가지를 바꿨다 —
 * 벽면 안쪽(몰딩과 벽 윗단 사이)으로 내리고, 벽에 그림자를 지게 하고,
 * 벽 색에서 뽑은 나무 테두리에 놋쇠 판을 끼웠다.
 * 걸이 두 개가 벽 윗단에서 내려와 실제로 매달린 것처럼 만든다.
 */
function drawSignboard() {
  const a = P(1, -1), b = P(4, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const w = 74, h = 22, L = Math.round(x - w / 2), T = Math.round(y - 44);

  X.save(); X.globalAlpha = 0.26;                       // 벽에 지는 그림자
  X.fillStyle = '#000000'; X.fillRect(L + 3, T + 3, w, h); X.restore();
  X.fillStyle = '#4A3E2E'; X.fillRect(L - 2, T - 2, w + 4, h + 4);      // 나무 테
  X.fillStyle = '#6B5B47'; X.fillRect(L - 2, T - 2, w + 4, 2);
  X.fillStyle = '#2E2A24'; X.fillRect(L, T, w, h);                       // 판
  X.fillStyle = '#C9A253'; X.fillRect(L, T, w, 3);                       // 놋쇠 윗단
  X.fillStyle = 'rgba(255,255,255,.06)'; X.fillRect(L, T + 3, w, 1);
  for (const bx of [L + 10, L + w - 12]) {                               // 걸이
    X.fillStyle = '#8A7659'; X.fillRect(bx, T - 8, 2, 7);
    X.fillStyle = '#C9A253'; X.fillRect(bx - 1, T - 9, 4, 2);
  }
  drawText(x, T + 15, S.co.name, { size: 12, color: '#F0DFAE', shadow: false });
}

/** 사무실 화이트보드 — 협상 중이면 진행도/성공도, 아니면 다음 등급 목표 */
function drawWhiteboard() {
  const a = P(10, -1), b = P(11, -1);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  /* 벽면 안쪽에 걸되 **직원 머리 위로** 올린다. y-46 에 두었더니 앞줄에 앉은
     사원의 얼굴을 가렸다 — 벽에 붙은 것과 사람을 가리는 것은 다른 문제다.
     폭도 줄여 뒤쪽 책상까지 덮지 않게 했다. */
  const w = 82, h = 29, ty = Math.round(y - 60), L = Math.round(x - w / 2);
  X.save(); X.globalAlpha = 0.24;
  X.fillStyle = '#000000'; X.fillRect(L + 3, ty + 3, w, h); X.restore();
  X.fillStyle = '#4A4436'; X.fillRect(L - 3, ty - 3, w + 6, h + 6);       // 알루미늄 틀
  X.fillStyle = '#635944'; X.fillRect(L - 3, ty - 3, w + 6, 2);
  X.fillStyle = '#EDEAE0'; X.fillRect(L, ty, w, h);
  X.fillStyle = '#C9C4B4'; X.fillRect(L, ty + h - 3, w, 3);
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
function drawPartition(items) {
  const put = (gx, gy, h, a, b, c) => {
    const { x, y } = P(gx, gy);
    items.push({ y, f: () => prism(X, x, y, HW, HH, h, a, b, c) });
  };
  for (let gy = 0; gy < roomH(); gy++) {
    if (gy === 4) continue;                              // 통로
    put(SPLIT_GX, gy, 39, '#4A3E2A', '#2C2418', '#3A3020');
  }
  put(SPLIT_GX, 4, 8, '#4A3E2A', '#2C2418', '#3A3020');
  for (let gy = 0; gy <= 2; gy++) put(12, gy, 30, '#5A4A38', '#3A2E20', '#4A3C2C');   // 사장실 세로 벽
  for (let gx = 13; gx < ROOM_W; gx++)                   // 사장실 가로 벽 (문 한 칸)
    put(gx, 3, gx === 13 ? 6 : 30, '#5A4A38', '#3A2E20', '#4A3C2C');
}

/* ── 매장 집기 ───────────────────────────────────────────── */
/** 재고율 0~1. 진열대가 비어 보이게 해서 발주 시점을 그림으로 알린다. */
function invRatio() { return clamp((S.co.inv ?? 100) / 100, 0, 1); }

/** n칸 중 재고만큼만 채운다 */
function stocked(n) { return Math.max(0, Math.round(n * invRatio())); }

/**
 * 진열 상품 색. **상품군에서 뽑는다** — 예전에는 `subs.slice(0,6)` 이라
 * 같은 업종을 여섯 개 사면 같은 색만 여섯 번 들어갔다. 매대가 다채로워지는 것이
 * "여러 업종을 갖췄다" 의 신호여야 한다.
 */
function palette() {
  return ['#7FB069', '#E0A24A', ...productLines(S).slice(0, 6).map(k => SECTORS[k].color)];
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

/** 이 타일이 속한 매대 구역에 배정된 상품군의 색. 없으면 null */
function zoneColor(gx, gy) {
  const z = shopZones(S), have = productLines(S);
  for (const zone of SHOP_ZONES) {
    if (!zone.tiles.some(t => t[0] === gx && t[1] === gy)) continue;
    const k = z[zone.id];
    return k && have.includes(k) ? SECTORS[k].color : null;
  }
  return null;
}

function drawShelf(o) {
  const { x, y } = P(o.gx, o.gy);
  /* 배정한 매대는 **그 상품군 색으로 채운다.** 발주 탭에서 고른 것이 화면에
     그대로 보여야 배정이 숫자놀음이 아니라 진열로 읽힌다. */
  const zc = zoneColor(o.gx, o.gy);
  const pal = zc ? [zc, shade(zc, 0.22), shade(zc, -0.18)] : palette();
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
  clerksNow().forEach((o, i) => {                               // 증설분 점원
    const c2 = P(o.gx, o.gy);
    drawPerson(c2.x, c2.y, clerk2, 'w', 1 - i % 2);
  });
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
  X.fillStyle = '#14182A'; X.fillRect(0, footY(), storeW(), storeH() - footY());
  X.fillStyle = '#39415F'; X.fillRect(0, footY(), storeW(), 2);
  const net = S.co.revToday - S.co.costToday;
  const cells = [
    ['일매출', won(S.co.revToday), '#FFD57A'],
    ['순익', (net >= 0 ? '+' : '') + won(net), net >= 0 ? '#4BD69B' : '#F07068'],
    ['인지도', '×' + S.co.marketing.toFixed(2), '#8FBEEA'],
    ['재고', Math.round(S.co.inv ?? 100) + '%', (S.co.inv ?? 100) < 25 ? '#F07068' : (S.co.inv ?? 100) < 60 ? '#FFD57A' : '#4BD69B'],
    ['손님', customers.length + '명', '#E3D8BB'],
    ['직원', S.staff.length + '명', '#E3D8BB'],
  ];
  const cw = storeW() / cells.length;
  cells.forEach(([k, v, c], i) => {
    if (i) { X.fillStyle = '#2A3046'; X.fillRect(i * cw, footY() + 5, 2, 15); }
    drawText(i * cw + cw / 2, footY() + 18, `${k} ${v}`, { size: 10, color: c, shadow: false });
  });
}

export { drawBackdrop, drawOutside, glassPanel, BOSS, CLERK, CLERK2, COUNTER, DESKS, DOOR, EXTRA_CLERK, EXTRA_COUNTER, EXTRA_FRIDGE, EXTRA_SHELF, FLATS, FREEZERS, FRIDGES, HOTSPOTS, P, QUEUE, SHELVES, SHOP_BLOCK, SHOP_PROPS, STREET_GX, STREET_MIN, addOffice, advancePhase, bar, blockedAt, clerksNow, countersNow, drawBossDesk, drawCounter, drawDesk, drawEmptyChair, drawFlat, drawFoot, drawFreezer, drawFridge, drawOfficeProp, drawPartition, drawProp, drawShelf, drawSignboard, drawStore, drawWallFittings, drawWalls, drawWhiteboard, facilKey, streetMax, streetSpot, findPath, fl, fridgesNow, inBossRoom, invRatio, newCustomer, offFloorPal, palette, retarget, shelvesNow, shopFloorPal, spawnCustomers, stepCustomers, stocked, storeFloor, storeHit, tileOf, walkable };
