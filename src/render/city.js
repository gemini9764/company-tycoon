import { SECTORS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, chance, pick, rnd } from '../core/util.js';
import { HH, HW, faces, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge } from './iso.js';
import { CITY_H, CITY_O, CITY_PAD_X, CITY_PAD_Y, CITY_W, MAP_H, MAP_W, X, drawLabel, drawPerson, drawPops, drawText, frame, hoverId, mix, newLook, shade, textW } from './canvas.js';

/* ══════════════════════════════════════════════════════════════
   도시 (M&A) — 쿼터뷰

   21×21 타일. tx 또는 ty 가 3의 배수인 줄이 도로, 나머지 2×2 가 블록이다.
   블록 49칸 중 24칸을 회사가 쓰고, 남는 칸은 도심일수록 오피스·아파트, 바깥일수록 논밭·주택으로 채운다.
   격자가 그대로 드러나지 않도록 블록마다 용도와 건물 실루엣을 다르게 준다.
   ══════════════════════════════════════════════════════════════ */

/* 좌표만 넣으면 항상 같은 값이 나오는 해시. 소품 배치를 랜덤처럼 보이게 하되
   프레임마다 자리가 바뀌지 않도록 쓴다. */
function h2(x, y) {
  let n = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/* 업종을 건물 실루엣으로 묶는다. 스카이라인에 차이를 만드는 축. */
const BLDG_STYLE = {
  it: 'tower', fin: 'tower', tech: 'tower',
  pharma: 'lab', build: 'plant', media: 'neon',
  daily: 'shop', food: 'shop', retail: 'shop', fashion: 'shop',
};

const BLDG_H = { tower: [36, 66], neon: [30, 50], lab: [28, 44], shop: [22, 36], plant: [20, 30] };

/* 회사가 안 쓰는 블록은 도심에서 멀어질수록 시골이 된다.
   가운데는 오피스·아파트가 빽빽하고 바깥으로 갈수록 상가 → 공원 → 논밭. */
function emptyKind(i, j, k) {
  const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
  if (ring <= 1) return k < 0.42 ? 'office' : k < 0.74 ? 'apart' : k < 0.9 ? 'shops' : 'plaza';
  if (ring === 2) return k < 0.3 ? 'shops' : k < 0.52 ? 'office' : k < 0.68 ? 'apart' : k < 0.84 ? 'park' : 'lot';
  return k < 0.3 ? 'farm' : k < 0.56 ? 'houses' : k < 0.76 ? 'park' : k < 0.9 ? 'shops' : 'lot';
}

/* 블록 바닥 색 — 지어질 것의 성격을 바닥부터 깐다 */
const KIND_FLOOR = {
  office: 'pave', apart: 'pave', shops: 'pave',
  plaza: 'plaza', lot: 'lot', park: 'grass', farm: 'soil', houses: 'yard',
};

const MY_H = [16, 24, 34, 44, 54, 64, 74];
const MY_R = [16, 19, 22, 24, 25, 26, 27];

const ROAD = '#3C4360', ROAD_EDGE = '#2F3550', WALK = '#5A6280';

let ground = null, builtFor = null, empties = [], traffic = [], plates = [];

/* ── 지면 캐시 ───────────────────────────────────────────── */
/* 타일 441장을 매 프레임 그리면 낭비다. 정지 화면이라 한 번 굽고 통째로 붙인다. */
function cityGround() {
  if (ground && builtFor === S) return ground;
  builtFor = S;
  buildEmpties();
  ensureTraffic();
  const LW = CITY_W + CITY_PAD_X * 2, LH = CITY_H + CITY_PAD_Y * 2;
  const O = { x: CITY_O.x + CITY_PAD_X, y: CITY_O.y + CITY_PAD_Y };
  const layer = makeLayer(LW, LH);
  const g = layer.ctx;
  if (g) {
    g.fillStyle = '#25402F'; g.fillRect(0, 0, LW, LH);
    drawOutskirts(g, O, LW, LH);
    for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
      const x = isoX(O, gx, gy), y = isoY(O, gx, gy);
      const rx = gx % 3 === 0, ry = gy % 3 === 0;
      if (rx || ry) drawRoadTile(g, x, y, rx, ry);
      else drawBlockTile(g, x, y, gx, gy);
    }
  }
  ground = layer;
  return ground;
}

/* ── 도시 밖 시골 ────────────────────────────────────────────
   좌우 여백이 허전해 보이지 않게 논밭·숲·연못을 성기게 흩뿌린다.
   빽빽하게 채우면 도심과 구분이 안 되므로 4×4 타일 단위로 뭉쳐서 배치한다.
   전부 지면 레이어에 구우므로 프레임 비용은 0이다.
   ─────────────────────────────────────────────────────────── */
function drawOutskirts(g, O, LW, LH) {
  const R = 30;
  const inMap = (gx, gy) => gx >= 0 && gx < MAP_W && gy >= 0 && gy < MAP_H;
  const cell = (gx, gy) => h2((gx >> 2) * 31 + 7, (gy >> 2) * 17 + 3);

  for (let pass = 0; pass < 2; pass++) {
    for (let gy = -R; gy < MAP_H + R; gy++) for (let gx = -R; gx < MAP_W + R; gx++) {
      if (inMap(gx, gy)) continue;
      const x = isoX(O, gx, gy), y = isoY(O, gx, gy);
      if (x < -24 || x > LW + 24 || y < -24 || y > LH + 24) continue;
      const ck = cell(gx, gy), r = h2(gx * 7 + 1, gy * 13 + 5);

      if (pass === 0) {                                   // 바닥
        if (ck < 0.16) {                                  // 논밭 뙈기
          rhomb(g, x, y, HW, HH, r > 0.5 ? '#6B5A3A' : '#635336');
          g.fillStyle = '#7D6A44';
          for (let i = -3; i <= 3; i += 2) g.fillRect(Math.round(x - 8 + i * 2), Math.round(y + i), 16, 1);
        } else if (ck < 0.22) {                           // 저수지
          rhomb(g, x, y, HW, HH, '#3E6E9C');
        } else {
          rhomb(g, x, y, HW, HH, ck < 0.36 ? '#2F5A3C' : (gx + gy) % 2 ? '#33593F' : '#2F5239');
        }
        continue;
      }

      if (ck >= 0.22 && ck < 0.36 && r < 0.42) drawTree(x, y, r, g);          // 숲
      else if (ck >= 0.36 && r < 0.05) drawTree(x, y, r * 12, g);             // 들판의 외딴 나무
      else if (ck >= 0.36 && r > 0.985) drawHouse(x, y - 2, r, g);            // 외딴집
      else if (ck < 0.16 && r > 0.97) drawShed(x, y, 0.4, g);                 // 논 옆 창고
    }
  }
}

/** 회사가 안 쓰는 블록에 지형을 배정한다. 좌표 해시라 매번 같은 결과가 나온다. */
function buildEmpties() {
  const used = new Set([`${S.co.lot.tx},${S.co.lot.ty}`, ...S.market.map(c => `${c.lot.tx},${c.lot.ty}`)]);
  empties = [];
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
    const tx = 1 + i * 3, ty = 1 + j * 3;
    if (used.has(`${tx},${ty}`)) continue;
    empties.push({ tx, ty, kind: emptyKind(i, j, h2(tx, ty)) });
  }
}

function kindOf(tx, ty) {
  const e = empties.find(k => k.tx === tx && k.ty === ty);
  return e ? e.kind : 'company';
}

function drawRoadTile(g, x, y, rx, ry) {
  rhomb(g, x, y, HW, HH, rx && ry ? '#3A4058' : ROAD);
  rhombEdge(g, x, y, HW, HH, ROAD_EDGE);
  if (rx && ry) {                                   // 교차로 — 횡단보도
    g.fillStyle = 'rgba(232,228,216,.22)';
    for (let i = -8; i <= 8; i += 4) {
      g.fillRect(Math.round(x + i), Math.round(y - 5 - i / 2), 2, 2);
      g.fillRect(Math.round(x + i), Math.round(y + 3 - i / 2), 2, 2);
    }
    return;
  }
  g.fillStyle = 'rgba(242,226,168,.20)';            // 차선
  if (rx) { g.fillRect(Math.round(x - 5), Math.round(y - 1), 8, 1); g.fillRect(Math.round(x - 1), Math.round(y + 2), 6, 1); }
  else    { g.fillRect(Math.round(x - 3), Math.round(y + 1), 8, 1); g.fillRect(Math.round(x - 1), Math.round(y - 2), 6, 1); }
}

/* 블록 바닥 — 용도마다 색과 무늬가 다르다 */
function drawBlockTile(g, x, y, gx, gy) {
  const tx = gx - (gx - 1) % 3, ty = gy - (gy - 1) % 3;   // 블록 좌상단 타일
  const floor = KIND_FLOOR[kindOf(tx, ty)] || 'pave';
  if (floor === 'grass') { rhomb(g, x, y, HW, HH, '#3B7048'); speckle(g, x, y, '#48864F', 5); }
  else if (floor === 'soil') {
    rhomb(g, x, y, HW, HH, '#6B5A3A');
    g.fillStyle = '#7D6A44';
    for (let i = -3; i <= 3; i += 2) g.fillRect(Math.round(x - 8 + i * 2), Math.round(y + i), 16, 1);
  }
  else if (floor === 'yard') { rhomb(g, x, y, HW, HH, '#57694B'); speckle(g, x, y, '#63764F', 3); }
  else if (floor === 'plaza') { rhomb(g, x, y, HW, HH, '#6A7288'); rhombEdge(g, x, y, HW, HH, '#59627E'); }
  else if (floor === 'lot') { rhomb(g, x, y, HW, HH, '#3F465F'); g.fillStyle = 'rgba(232,228,216,.16)'; g.fillRect(Math.round(x - 8), Math.round(y - 2), 16, 1); }
  else { rhomb(g, x, y, HW, HH, WALK); rhombEdge(g, x, y, HW, HH, '#5A6480'); }
}

function speckle(g, x, y, color, n) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.fillRect(Math.round(x - 9 + h2(x + i * 13, y + i * 7) * 18), Math.round(y - 3 + h2(y, x + i) * 6), 2, 1);
  }
}

/* ── 차량 · 보행자 ───────────────────────────────────────── */
/* 도로가 3칸 간격이라 이동 축과 차선 번호만 있으면 위치가 나온다. */
function ensureTraffic() {
  const lanes = [3, 6, 9, 12, 15];   // 바깥 둘레 도로는 오프셋이 맵 밖으로 나간다
  traffic = [];
  for (let i = 0; i < 10; i++) {
    const kind = chance(0.16) ? 'bus' : chance(0.24) ? 'truck' : 'car';
    traffic.push({
      type: 'car', kind, axis: chance(0.5) ? 'x' : 'y', lane: pick(lanes),
      t: Math.random() * (MAP_W - 1), dir: chance(0.5) ? 1 : -1, sp: rnd(0.018, 0.04),
      c: kind === 'bus' ? pick(['#4A86C7', '#2FA37A'])
        : kind === 'truck' ? pick(['#E8E4D8', '#8A8F9E'])
        : pick(['#D0453B', '#4A86C7', '#F2B233', '#E8E4D8', '#2FA37A', '#8B5CB8']),
    });
  }
  for (let i = 0; i < 11; i++) {
    traffic.push({
      type: 'ped', axis: chance(0.5) ? 'x' : 'y', lane: pick(lanes),
      t: Math.random() * (MAP_W - 1), dir: chance(0.5) ? 1 : -1, sp: rnd(0.006, 0.014),
      look: newLook(), walk: 0, off: rnd(-0.34, 0.34),
    });
  }
}

/* 걷기 위상은 프레임이 아니라 **이동 거리**로 쌓는다. 프레임이나 좌표로 뽑으면
   소수점 위치가 매 프레임 흔들려 발이 떨리는 것처럼 보인다. */
function moveTraffic() {
  const spd = S.speed || 1;
  for (const t of traffic) {
    const d = t.sp * spd;
    t.t += d * t.dir;
    if (t.t > MAP_W - 1) t.t = 0;
    if (t.t < 0) t.t = MAP_W - 1;
    if (t.type === 'ped') t.walk += d;
  }
}

function trafficPos(t) {
  const off = t.type === 'ped' ? t.off : (t.dir > 0 ? 0.3 : -0.3);
  return t.axis === 'x' ? { gx: t.t, gy: t.lane + off } : { gx: t.lane + off, gy: t.t };
}

/** 보행자가 향한 쪽. 화면 기준이라 축과 방향을 같이 본다. */
function pedFace(t) {
  return t.axis === 'x' ? (t.dir > 0 ? 'e' : 'w') : (t.dir > 0 ? 's' : 'n');
}

/* 상자 프리미티브는 정사각 바닥만 그린다. 진행 축으로 두 채를 겹쳐
   길쭉한 차체를 만든다. */
function drawCar(t, x, y) {
  const long = t.kind === 'bus' ? 8 : t.kind === 'truck' ? 6 : 4;
  const h = t.kind === 'bus' ? 11 : 8, rx = 8, ry = 4;
  const ox = long, oy = t.axis === 'x' ? long / 2 : -long / 2;
  X.save(); X.globalAlpha = 0.24;
  rhomb(X, x + 2, y + 1, rx + long, (rx + long) / 2, '#000000'); X.restore();
  for (const s of [-1, 1]) {
    const cx = x + ox * s, cy = y + oy * s;
    prism(X, cx, cy, rx, ry, h, shade(t.c, 0.24), shade(t.c, -0.26), t.c);
  }
  prism(X, x, y, rx, ry, h, shade(t.c, 0.24), shade(t.c, -0.26), t.c);
  isoWin(X, x + ox, y + oy, rx, ry, 'r', 3, h - 5, 6, 4, '#20263A');
  isoWin(X, x, y, rx, ry, 'l', 3, h - 5, 6, 4, '#161C2C');
  X.fillStyle = '#FFE9A8'; X.fillRect(Math.round(x + ox + 4), Math.round(y + oy + 1), 2, 1);
}

/* ── 그리기 ──────────────────────────────────────────────── */
function drawCity() {
  const g = cityGround();
  if (g && g.c) X.drawImage(g.c, -CITY_PAD_X, -CITY_PAD_Y);
  moveTraffic();

  /* 쿼터뷰는 화면 아래쪽이 앞이다. 바닥 y 로 정렬해야 앞뒤가 맞는다. */
  const items = [];
  for (const c of S.market) items.push({ y: lotY(c.lot), f: () => drawBuilding(c) });
  items.push({ y: lotY(S.co.lot), f: drawMyBuilding });
  for (const e of empties) items.push({ y: lotY(e), f: () => drawTerrain(e) });
  for (const t of traffic) {
    const p = trafficPos(t);
    const x = isoX(CITY_O, p.gx, p.gy), y = isoY(CITY_O, p.gx, p.gy);
    items.push({
      y,
      f: t.type === 'car' ? () => drawCar(t, x, y)
        : () => drawPerson(x, y, t.look, pedFace(t), Math.floor(t.walk * 5)),
    });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.f();

  flushPlates();
  drawNegoMark();
  drawPops();
}

function lotY(lot) { return isoY(CITY_O, lot.tx + 1, lot.ty + 1); }

function lotC(lot) { return { x: isoX(CITY_O, lot.tx + 1, lot.ty + 1), y: lotY(lot) }; }

/* ── 지형 블록 ───────────────────────────────────────────── */
const FILL_BODY = ['#5A6480', '#6B6E86', '#7A6E6A', '#5E7480', '#6E6480', '#7A7460'];

function drawTerrain(e) {
  const { x, y } = lotC(e);
  const k = h2(e.tx * 3, e.ty * 7);
  if (e.kind === 'office') return drawFillOffice(x, y, k, e);
  if (e.kind === 'apart') return drawFillApart(x, y, k, e);
  if (e.kind === 'shops') return drawFillShops(x, y, k, e);
  if (e.kind === 'park') {
    drawPond(x + 13, y + 3);
    for (const [dx, dy] of [[-18, -2], [-6, -9], [4, 7], [-13, 8]]) drawTree(x + dx, y + dy, h2(e.tx + dx, e.ty + dy));
    drawBench(x - 3, y + 1);
  } else if (e.kind === 'farm') {
    for (let i = 0; i < 5; i++) drawCrop(x - 20 + i * 9, y - 7 + i * 4);
    for (let i = 0; i < 4; i++) drawCrop(x - 6 + i * 9, y + 5 + i * 4);
    drawShed(x + 17, y - 5);
  } else if (e.kind === 'houses') {
    drawHouse(x - 15, y - 5, h2(e.tx, e.ty));
    drawHouse(x + 9, y + 3, h2(e.ty, e.tx));
    drawTree(x - 2, y + 11, 0.4);
  } else if (e.kind === 'plaza') {
    drawFountain(x, y);
    drawBench(x - 20, y + 2); drawBench(x + 18, y + 2);
    drawTree(x - 7, y - 11, 0.7); drawTree(x + 11, y - 9, 0.2);
  } else {
    for (let i = 0; i < 3; i++) {
      const c = ['#D0453B', '#4A86C7', '#E8E4D8'][i];
      prism(X, x - 14 + i * 13, y - 7 + i * 6, 6, 3, 6, shade(c, 0.22), shade(c, -0.26), c);
    }
  }
}

/* 채움 오피스 — 인수 대상이 아니라 도시를 메우는 건물. 상호판이 없어
   플레이어 눈에 '클릭할 것'과 구분된다. */
function drawFillOffice(x, y, k, e) {
  const h = Math.round(26 + k * 34), rx = 24 + Math.round(k * 4) * 2, ry = rx / 2;
  const body = FILL_BODY[Math.floor(k * FILL_BODY.length)];
  X.save(); X.globalAlpha = 0.24; rhomb(X, x + 3, y + 2, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(body, 0.24), shade(body, -0.3), body);
  const rows = Math.floor((h - 12) / 7);
  for (let r = 0; r < rows; r++) for (let i = 0; i < 3; i++) {
    const lit = ((e.tx + e.ty + i * 3 + r * 5 + Math.floor(frame / 100)) % 6) < 2;
    const col = lit ? '#F2E2A8' : '#2C3550';
    isoWin(X, x, y, rx, ry, 'l', 6 + i * 8, 6 + r * 7, 4, 4, shade(col, -0.16));
    isoWin(X, x, y, rx, ry, 'r', 6 + i * 8, 6 + r * 7, 4, 4, col);
  }
  drawRoofProps(x, y, h, rx, k);
}

/* 채움 아파트 — 층마다 발코니 띠가 있어 오피스와 실루엣이 갈린다 */
function drawFillApart(x, y, k, e) {
  const h = Math.round(30 + k * 30), rx = 22 + Math.round(k * 3) * 2, ry = rx / 2;
  const wall = k > 0.5 ? '#9A9080' : '#8A8676';
  X.save(); X.globalAlpha = 0.24; rhomb(X, x + 3, y + 2, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(wall, 0.22), shade(wall, -0.3), wall);
  for (let r = 0; r * 8 < h - 8; r++) {
    faces(X, x, y, rx, ry, 5 + r * 8, 8 + r * 8, shade(wall, -0.42), shade(wall, -0.24));   // 발코니
    for (let i = 0; i < 3; i++) {
      const lit = ((e.tx + i * 5 + r * 3 + Math.floor(frame / 120)) % 5) < 3;
      isoWin(X, x, y, rx, ry, 'r', 5 + i * 8, 8 + r * 8, 4, 4, lit ? '#FFE9A8' : '#39415F');
    }
  }
  prism(X, x, y - h, rx + 2, (rx + 2) / 2, 2, '#6E7488', '#454B5E', '#5E6478');
  drawRoofProps(x, y, h + 2, rx, k);
}

/* 채움 상가 — 낮은 건물 두세 채가 붙어 있다 */
function drawFillShops(x, y, k, e) {
  const tint = ['#C4553F', '#4E7A9C', '#7A6A9C', '#C6A24A', '#4E8A6A'];
  for (let i = 0; i < 3; i++) {
    const kk = h2(e.tx + i * 11, e.ty + i * 5);
    const h = Math.round(13 + kk * 12);
    const cx = x - 16 + i * 16, cy = y - 8 + i * 8;
    const c = tint[Math.floor(kk * tint.length)];
    prism(X, cx, cy, 12, 6, h, '#D8CBA8', '#8A8070', '#B7AC96');
    faces(X, cx, cy, 12, 6, h - 4, h, shade(c, -0.34), c);                 // 간판
    isoWin(X, cx, cy, 12, 6, 'r', 3, 3, 6, 5, kk > 0.5 ? '#F2E2A8' : '#8AB4D8');
  }
}

/* 옥상 소품 — 물탱크·실외기·광고탑·헬리패드. 스카이라인에 잔가지를 준다. */
function drawRoofProps(x, y, h, rx, k) {
  const top = y - h;
  if (k < 0.3) {                                          // 물탱크
    prism(X, x + 6, top + 2, 6, 3, 7, '#7D8598', '#4A5266', '#6A7288');
  } else if (k < 0.55) {                                  // 실외기 세 대
    for (let i = 0; i < 3; i++) prism(X, x - 8 + i * 8, top - 2 + i * 4, 4, 2, 4, '#9AA0B0', '#5E6478', '#7D8598');
  } else if (k < 0.78) {                                  // 광고탑
    X.fillStyle = '#59627E'; X.fillRect(Math.round(x - 5), Math.round(top - 12), 2, 12);
    X.fillStyle = '#59627E'; X.fillRect(Math.round(x + 5), Math.round(top - 12), 2, 12);
    X.fillStyle = Math.floor(frame / 40) % 2 ? '#F2B233' : '#8A6A2A';
    X.fillRect(Math.round(x - 7), Math.round(top - 18), 16, 7);
  } else {                                                // 헬리패드
    rhomb(X, x, top - 1, 11, 5, '#454B5E');
    X.fillStyle = '#E8E4D8';
    X.fillRect(Math.round(x - 3), Math.round(top - 4), 2, 6); X.fillRect(Math.round(x + 2), Math.round(top - 4), 2, 6);
    X.fillRect(Math.round(x - 2), Math.round(top - 2), 5, 2);
  }
}

/* 소품들은 메인 캔버스와 지면 레이어 양쪽에 그려야 하므로 컨텍스트를 받는다. */
function drawTree(x, y, r, g = X) {
  const big = r > 0.5;
  g.save(); g.globalAlpha = 0.22; rhomb(g, x + 1, y + 1, big ? 8 : 6, big ? 4 : 3, '#000000'); g.restore();
  g.fillStyle = '#4A3728'; g.fillRect(Math.round(x) - 1, Math.round(y) - 7, 3, 7);
  const c = big ? '#2F6B45' : '#3A7C4E';
  prism(g, x, y - 7, big ? 10 : 8, big ? 5 : 4, big ? 10 : 8, shade(c, 0.32), shade(c, -0.24), c);
}

function drawBench(x, y) {
  prism(X, x, y, 8, 4, 3, '#9C7A56', '#6B5136', '#8A6A4A');
  X.fillStyle = '#6B5136'; X.fillRect(Math.round(x) - 7, Math.round(y) - 9, 2, 6);
}

function drawPond(x, y) {
  rhomb(X, x, y, 15, 7, '#3E6E9C');
  rhomb(X, x, y, 11, 5, '#4E86B8');
  X.fillStyle = 'rgba(255,255,255,.26)'; X.fillRect(Math.round(x) - 5, Math.round(y) - 2, 6, 1);
}

function drawCrop(x, y) {
  X.fillStyle = '#5C8A3E';
  for (let i = 0; i < 3; i++) X.fillRect(Math.round(x) + i * 3, Math.round(y) - 4 - (i % 2), 2, 5);
}

function drawShed(x, y, s, g = X) {
  const rx = s ? 8 : 10, h = s ? 7 : 8;
  prism(g, x, y, rx, rx / 2, h, '#8A6A4A', '#5C4630', '#7A5C40');
  prism(g, x, y - h, rx + 1, (rx + 1) / 2, 3, '#D06A50', '#8A3A2A', '#C4553F');
}

function drawHouse(x, y, r, g = X) {
  const wall = r > 0.5 ? '#D8CBA8' : '#C6B695';
  const roof = r > 0.66 ? '#C4553F' : r > 0.33 ? '#4E7A9C' : '#7A6A9C';
  prism(g, x, y, 12, 6, 12, shade(wall, 0.14), shade(wall, -0.26), wall);
  isoWin(g, x, y, 12, 6, 'r', 4, 4, 4, 4, '#F2E2A8');
  isoWin(g, x, y, 12, 6, 'l', 4, 4, 4, 4, '#8AA8C4');
  prism(g, x, y - 12, 13, 6, 4, shade(roof, 0.22), shade(roof, -0.26), roof);
  rhomb(g, x, y - 20, 7, 4, shade(roof, 0.1));
}

function drawFountain(x, y) {
  rhomb(X, x, y, 16, 8, '#7D8598');
  rhomb(X, x, y, 12, 6, '#4E86B8');
  prism(X, x, y, 4, 2, 8, '#9AA0B0', '#6E7488', '#8A8F9E');
  X.fillStyle = 'rgba(198,220,255,.55)';
  const t = Math.round(Math.sin(frame / 14) * 2);
  X.fillRect(Math.round(x) - 1, Math.round(y) - 15 - t, 2, 7 + t);
}

/* ── 회사 건물 ───────────────────────────────────────────── */
/** 건물 한 채의 기하. 그리기와 클릭 판정이 같은 값을 써야 어긋나지 않는다. */
function bldgGeom(c) {
  const { x, y } = lotC(c.lot);
  const style = BLDG_STYLE[c.sector] || 'shop';
  const scale = Math.min(1, Math.max(0, (Math.log10(Math.max(10, c.cap)) - 7.6) / 5.4));
  const [h0, h1] = BLDG_H[style];
  const rx = style === 'plant' ? 30 : Math.round((20 + scale * 8) / 2) * 2;
  return { x, y, rx, ry: rx / 2, h: Math.round(h0 + scale * (h1 - h0)), style, scale };
}

function drawBuilding(c) {
  const g = bldgGeom(c);
  const sec = SECTORS[c.sector];
  const seed = c.lot.tx * 7 + c.lot.ty * 13;
  const body = c.owned ? '#4C7358' : mix(sec.color, '#3A4468', 0.62);
  const { x, y, rx, ry, h } = g;

  drawApron(x, y, c.lot);
  X.save(); X.globalAlpha = 0.26; rhomb(X, x + 3, y + 2, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(body, 0.26), shade(body, -0.28), body);

  if (g.style === 'tower') drawTower(c, g, sec, seed, body);
  else if (g.style === 'lab') drawLab(c, g, sec);
  else if (g.style === 'plant') drawPlant(c, g);
  else if (g.style === 'neon') drawNeon(c, g, sec, seed);
  else drawShop(c, g, sec, seed);

  drawSign(x, y, rx, ry, sec, c.curse > 0);
  if (g.style === 'shop' || g.style === 'lab') drawRoofProps(x, y, h, rx, h2(c.lot.ty, c.lot.tx));

  if (c.owned) {                                        // 계열사 깃발
    X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x + rx - 9), Math.round(y - h - 14), 1, 12);
    X.fillStyle = '#F2B233'; X.fillRect(Math.round(x + rx - 8), Math.round(y - h - 14), 7, 5);
  }
  if (c.curse > 0) {
    X.save(); X.globalAlpha = 0.18 + Math.sin(frame / 8) * 0.10;
    prism(X, x, y, rx, ry, h + 3, '#8B5CB8', '#8B5CB8', '#8B5CB8'); X.restore();
  }
  if (hoverId === c.id) {
    X.save(); X.globalAlpha = 0.5 + Math.sin(frame / 10) * 0.2;
    rhombEdge(X, x, y - h, rx, ry, '#FFD57A'); rhombEdge(X, x, y, rx, ry, '#FFD57A'); X.restore();
  }
  drawNamePlate(x, y, c.name, c.owned ? '#FFD57A' : '#D6DAEA');
}

/** 건물 앞 여백 — 주차 구획이나 화단 */
function drawApron(x, y, lot) {
  const k = h2(lot.tx * 5, lot.ty * 11);
  if (k < 0.4) {
    X.fillStyle = 'rgba(232,228,216,.20)';
    for (let i = 0; i < 3; i++) X.fillRect(Math.round(x - 16 + i * 9), Math.round(y + 12 + i * 3), 6, 1);
  } else if (k < 0.72) {
    rhomb(X, x - 17, y + 8, 7, 4, '#2F6B45');
    rhomb(X, x + 15, y + 9, 6, 3, '#2F6B45');
  } else {
    X.fillStyle = '#59627E';
    for (let i = 0; i < 4; i++) X.fillRect(Math.round(x - 11 + i * 5), Math.round(y + 11 + i), 1, 4);
  }
}

/** 1층 간판띠 + 출입문 — 모든 스타일이 공유 */
function drawSign(x, y, rx, ry, sec, cursed) {
  const c = cursed ? '#6A4270' : sec.color;
  faces(X, x, y, rx, ry, 0, 8, shade(c, -0.32), c);
  faces(X, x, y, rx, ry, 8, 9, shade(c, 0.22), shade(c, 0.34));
  isoWin(X, x, y, rx, ry, 'r', rx - 12, 0, 8, 7, '#20263A');
  isoWin(X, x, y, rx, ry, 'r', rx - 10, 1, 4, 5, '#8AB4D8');
}

function drawTower(c, g, sec, seed, body) {
  const { x, y, rx, ry, h } = g;
  faces(X, x, y, rx, ry, h - 3, h, shade(sec.color, -0.45), shade(sec.color, -0.30));
  const rows = Math.floor((h - 22) / 8);
  for (let r = 0; r < rows; r++) for (let i = 0; i < 3; i++) {
    const lit = ((seed + i * 3 + r * 5 + Math.floor(frame / 90)) % 5) < 2;
    const col = c.curse > 0 ? '#5A3B52' : lit ? '#F2E2A8' : '#2C3550';
    isoWin(X, x, y, rx, ry, 'l', 6 + i * 8, 13 + r * 8, 4, 4, shade(col, -0.14));
    isoWin(X, x, y, rx, ry, 'r', 6 + i * 8, 13 + r * 8, 4, 4, col);
  }
  if (h > 48) {
    const rr = rx - 8;
    prism(X, x, y - h, rr, rr / 2, 8, shade(body, 0.30), shade(body, -0.24), body);
  }
  X.fillStyle = '#59627E'; X.fillRect(Math.round(x + 6), Math.round(y - h - 12), 6, 5);
  X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x - 6), Math.round(y - h - 17), 1, 13);
  X.fillStyle = Math.floor(frame / 30) % 2 ? '#D0453B' : '#5A2020';
  X.fillRect(Math.round(x - 7), Math.round(y - h - 19), 3, 2);
}

function drawLab(c, g, sec) {
  const { x, y, rx, ry, h } = g;
  faces(X, x, y, rx, ry, 9, h - 4, '#B0AC9E', '#D6D2C4');
  for (let r = 0; r * 9 < h - 20; r++) {
    const col = c.curse > 0 ? '#5A3B52' : '#8AB4D8';
    isoWin(X, x, y, rx, ry, 'l', 4, 14 + r * 9, rx - 8, 5, shade(col, -0.18));
    isoWin(X, x, y, rx, ry, 'r', 4, 14 + r * 9, rx - 8, 5, col);
  }
  faces(X, x, y, rx, ry, h - 4, h, shade(sec.color, -0.28), shade(sec.color, -0.1));
  X.fillStyle = '#E8E4D8';
  X.fillRect(Math.round(x - 4), Math.round(y - h - 10), 9, 3);
  X.fillRect(Math.round(x - 1), Math.round(y - h - 13), 3, 9);
}

function drawPlant(c, g) {
  const { x, y, rx, ry, h } = g;
  for (let i = 0; i < 3; i++)                            // 톱니 지붕
    prism(X, x - 13 + i * 13, y - h - 6 + i * 6, 7, 4, 5, '#7E8298', '#4E5266', '#6E7288');
  const col = c.curse > 0 ? '#5A3B52' : '#8AB4D8';
  for (let i = 0; i < 3; i++) isoWin(X, x, y, rx, ry, 'r', 6 + i * 9, 12, 6, 5, col);
  prism(X, x - rx + 12, y - 4, 5, 3, Math.round(h * 0.7) + 8, '#5A6480', '#3E4763', '#4A5273');  // 굴뚝
  X.fillStyle = '#D0453B'; X.fillRect(Math.round(x - rx + 7), Math.round(y - Math.round(h * 0.7) - 16), 10, 3);
  const ct = y - Math.round(h * 0.7) - 20;
  X.save(); X.globalAlpha = 0.16 + Math.sin(frame / 26) * 0.07;
  rhomb(X, x - rx + 12, ct - 6, 8, 4, '#C6CCE2');
  rhomb(X, x - rx + 17, ct - 14, 6, 3, '#C6CCE2'); X.restore();
}

function drawNeon(c, g, sec, seed) {
  const { x, y, rx, ry, h } = g;
  const col = c.curse > 0 ? '#5A3B52' : shade(sec.color, 0.05);
  const bh = Math.max(6, h - 24);
  isoWin(X, x, y, rx, ry, 'r', 4, 13, rx - 8, bh, col);                  // 전광판
  isoWin(X, x, y, rx, ry, 'r', 4, 13 + Math.floor(frame / 12 + seed) % bh, rx - 8, 2, 'rgba(11,15,27,.5)');
  for (let i = 0; i < 3; i++)
    if ((i + Math.floor(frame / 18)) % 3 === 0) isoWin(X, x, y, rx, ry, 'l', 6 + i * 8, 15, 4, 10, '#F2E2A8');
  faces(X, x, y, rx, ry, h - 3, h, shade(sec.color, -0.42), shade(sec.color, -0.26));
}

function drawShop(c, g, sec, seed) {
  const { x, y, rx, ry, h } = g;
  const rows = Math.max(1, Math.floor((h - 16) / 8));
  for (let r = 0; r < rows; r++) for (let i = 0; i < 3; i++) {
    const lit = ((seed + i * 3 + r * 5 + Math.floor(frame / 90)) % 5) < 3;
    const col = c.curse > 0 ? '#5A3B52' : lit ? '#F2E2A8' : '#2C3550';
    isoWin(X, x, y, rx, ry, 'l', 6 + i * 8, 12 + r * 8, 4, 5, shade(col, -0.14));
    isoWin(X, x, y, rx, ry, 'r', 6 + i * 8, 12 + r * 8, 4, 5, col);
  }
  faces(X, x, y, rx, ry, h - 3, h, shade(sec.color, -0.42), shade(sec.color, -0.24));            // 처마
  const rr = rx + 2;
  prism(X, x, y - h, rr, rr / 2, 1, shade(sec.color, 0.2), shade(sec.color, -0.25), sec.color);
}

function drawNamePlate(x, y, name, color) { plates.push({ x, y, name, color }); }

function flushPlates() {
  for (const p of plates) {
    const w = Math.max(18, Math.round(textW(p.name, 10)) + 8);
    X.fillStyle = 'rgba(11,15,27,.82)'; X.fillRect(Math.round(p.x - w / 2), Math.round(p.y + 14), w, 11);
    drawText(p.x, p.y + 22, p.name, { size: 10, color: p.color, shadow: false });
  }
  plates.length = 0;
}

/* ── 플레이어 건물 — 등급마다 형태가 바뀐다 ──────────────── */
function drawMyBuilding() {
  const { x, y } = lotC(S.co.lot), tier = S.co.tier;
  const h = MY_H[tier], rx = MY_R[tier], ry = rx / 2;

  drawApron(x, y, S.co.lot);
  X.save(); X.globalAlpha = 0.3; rhomb(X, x + 3, y + 2, rx, ry, '#000000'); X.restore();

  if (tier === 0) {                                  // 구멍가게 — 박공지붕 주택
    prism(X, x, y, rx, ry, h, '#9C7A56', '#6B4F34', '#8A6A4A');
    isoWin(X, x, y, rx, ry, 'r', 4, 5, 6, 6, '#F2E2A8');
    isoWin(X, x, y, rx, ry, 'l', 4, 5, 6, 6, '#8AA8C4');
    prism(X, x, y - h, rx + 2, (rx + 2) / 2, 4, '#D06A50', '#8A3A2A', '#C4553F');
    rhomb(X, x, y - h - 11, 9, 4, '#C4553F');
  } else {
    const body = '#54607E';
    prism(X, x, y, rx, ry, h, shade(body, 0.28), shade(body, -0.28), body);
    const rows = [0, 2, 3, 4, 5, 6, 7][tier];
    for (let r = 0; r < rows; r++) for (let i = 0; i < 2; i++) {
      const lit = ((i * 3 + r * 7 + Math.floor(frame / 70)) % 4) < 3;
      const col = lit ? '#FFE9A8' : '#2C3550';
      isoWin(X, x, y, rx, ry, 'l', 6 + i * 9, 14 + r * 8, 5, 5, shade(col, -0.14));
      isoWin(X, x, y, rx, ry, 'r', 6 + i * 9, 14 + r * 8, 5, 5, col);
    }
    faces(X, x, y, rx, ry, h - 4, h, '#C08820', '#F2B233');
    if (tier >= 4) prism(X, x + 6, y - h, 6, 3, 6, '#7D8598', '#4E5266', '#6E7288');
    if (tier >= 5) {
      X.fillStyle = '#C6CCE2'; X.fillRect(Math.round(x - 4), Math.round(y - h - 14), 1, 12);
      X.fillStyle = '#D0453B'; X.fillRect(Math.round(x - 3), Math.round(y - h - 14), 8, 5);
    }
  }
  faces(X, x, y, rx, ry, 0, 8, '#8A6A2A', '#F2B233');     // 금빛 1층
  isoWin(X, x, y, rx, ry, 'r', rx - 11, 0, 6, 7, '#20263A');

  X.save(); X.globalAlpha = 0.35 + Math.sin(frame / 22) * 0.22;
  rhombEdge(X, x, y, rx + 4, (rx + 4) / 2, '#FFD57A'); X.restore();
  drawNamePlate(x, y, S.co.name, '#FFD57A');
}

/* ── 협상 표시 ───────────────────────────────────────────── */
function drawNegoMark() {
  if (!S.nego) return;
  const t = S.market.find(c => c.id === S.nego.id);
  if (!t) return;
  const g = bldgGeom(t);
  const pl = Math.round(2 + Math.sin(frame / 12) * 2) * 2;
  X.save(); X.globalAlpha = 0.8;
  rhombEdge(X, g.x, g.y, 30 + pl, (30 + pl) / 2, '#8FBEEA'); X.restore();
  drawLabel(g.x, g.y - g.h - 14, `협상 ${Math.round(S.nego.progress)}%`, '#8FBEEA');
}

/* ── 클릭 판정 ───────────────────────────────────────────── */
/* 건물이 위로 솟아 있어 바닥 마름모만으로는 못 잡는다. 건물을 감싼 사각형을
   화면 앞(아래)에서부터 훑어 먼저 걸리는 것을 고른다. */
function cityHit(p) {
  const list = [
    ...S.market.map(c => ({ co: c, g: bldgGeom(c) })),
    { self: true, g: myGeom() },
  ].sort((a, b) => b.g.y - a.g.y);
  for (const it of list) {
    const { x, y, rx, ry, h } = it.g;
    if (p.x >= x - rx && p.x <= x + rx && p.y >= y - ry - h && p.y <= y + ry) return it;
  }
  return null;
}

function myGeom() {
  const { x, y } = lotC(S.co.lot), rx = MY_R[S.co.tier];
  return { x, y, rx, ry: rx / 2, h: MY_H[S.co.tier] };
}

export { bldgGeom, flushPlates, drawOutskirts, emptyKind, drawFillApart, drawFillOffice, drawFillShops, drawRoofProps, KIND_FLOOR, FILL_BODY, buildEmpties, cityGround, cityHit, drawApron, drawBench, drawBlockTile, drawBuilding, drawCar, drawCity, drawCrop, drawFountain, drawHouse, drawLab, drawMyBuilding, drawNamePlate, drawNegoMark, drawNeon, drawPlant, drawPond, drawRoadTile, drawShed, drawShop, drawSign, drawTerrain, drawTower, drawTree, ensureTraffic, h2, kindOf, lotC, lotY, moveTraffic, myGeom, pedFace, speckle, trafficPos };
