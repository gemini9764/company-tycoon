import { BAL } from '../core/balance.js';
import { SECTORS } from '../core/data.js';
import { S } from '../core/state.js';
import { viewRand } from '../core/rng.js';
import { $, clamp, vchance, vpick, vrnd } from '../core/util.js';
import { HH, HW, faces, isoRotMat, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge, rotFace, rotG, rotGf } from './iso.js';
import { CITY_H, CITY_O, CITY_PAD_X, CITY_PAD_Y, CITY_W, MAP_H, MAP_W, X, drawLabel, drawPerson, drawPops, drawText, frame, hoverId, mix, newLook, shade, textW } from './canvas.js';

/* ══════════════════════════════════════════════════════════════
   도시 (M&A) — 쿼터뷰

   32×32 타일. blockPitch(4) 주기로 2칸이 블록, 2칸이 도로다 — 블록 사이 도로가
   두 줄이라 건물이 서로 붙지 않는다. 블록 64칸 중 45칸을 회사가 쓰고, 남는 칸은
   도심일수록 오피스·아파트, 바깥일수록 논밭·주택으로 채운다.
   격자가 그대로 드러나지 않도록 블록마다 용도와 건물 실루엣을 다르게 준다.
   ══════════════════════════════════════════════════════════════ */

/* 좌표만 넣으면 항상 같은 값이 나오는 해시. 소품 배치를 랜덤처럼 보이게 하되
   프레임마다 자리가 바뀌지 않도록 쓴다. */
/* 블록은 pitch 주기의 1·2번 칸이고 나머지(0·3번)가 도로다.
   pitch 가 4의 배수라 이 판정은 gx → W-1-gx 로 뒤집어도 그대로 성립한다 — 회전해도 안 깨진다. */
function isRoad(g) { const m = ((g % BAL.blockPitch) + BAL.blockPitch) % BAL.blockPitch; return m === 0 || m === BAL.blockPitch - 1; }

/** 그 타일이 속한 블록의 좌상단 타일 */
function blockOrigin(g) { return g - (((g - 1) % BAL.blockPitch) + BAL.blockPitch) % BAL.blockPitch; }

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

const BLDG_H = { tower: [54, 99], neon: [45, 75], lab: [42, 66], shop: [33, 54], plant: [30, 45] };

/* 회사가 안 쓰는 블록은 도심에서 멀어질수록 시골이 된다.
   가운데는 오피스·아파트가 빽빽하고 바깥으로 갈수록 상가 → 공원 → 논밭.
   ring 은 블록 격자 중심으로부터의 거리라 블록 수가 바뀌어도 따라간다. */
function emptyKind(i, j, k) {
  const c = (BAL.cityBlocks - 1) / 2;
  const ring = Math.round(Math.max(Math.abs(i - c), Math.abs(j - c)));
  /* 도심 반경은 블록 수에 비례해야 한다. 상수로 두면 맵을 넓힐 때 도심만 그대로 좁아진다. */
  if (ring <= BAL.cityBlocks * 0.2) return k < 0.42 ? 'office' : k < 0.74 ? 'apart' : k < 0.9 ? 'shops' : 'plaza';
  if (ring <= BAL.cityBlocks * 0.35) return k < 0.3 ? 'shops' : k < 0.52 ? 'office' : k < 0.68 ? 'apart' : k < 0.84 ? 'park' : 'lot';
  return k < 0.3 ? 'farm' : k < 0.56 ? 'houses' : k < 0.76 ? 'park' : k < 0.9 ? 'shops' : 'lot';
}

/* 블록 바닥 색 — 지어질 것의 성격을 바닥부터 깐다 */
const KIND_FLOOR = {
  office: 'pave', apart: 'pave', shops: 'pave',
  plaza: 'plaza', lot: 'lot', park: 'grass', farm: 'soil', houses: 'yard',
};

const MY_H = [24, 36, 51, 66, 81, 96, 111];
const MY_R = [24, 28, 34, 36, 38, 40, 42];        // rx 는 짝수여야 마름모 사선이 안 어긋난다

const ROAD = '#A2A8BC', ROAD_EDGE = '#9096AC', WALK = '#C6CAD6';

let ground = null, builtFor = null, bakedView = -1, empties = [], traffic = [], plates = [];

/* ── 회전 전환 ────────────────────────────────────────────────
   예전에는 화면을 한 번 어둡게 덮고 그 사이에 방향을 바꿨다. "2D 라 중간 각도를
   못 그린다"고 봤기 때문인데, 그게 틀렸다 — **타일 좌표를 실수로 돌리면 중간
   각도가 나온다** (`rotGf`). 건물은 그 궤적을 따라 호를 그리며 옮겨 가고,
   스프라이트 자체는 세워 둔다.

   지면 레이어만 프레임마다 다시 구울 수 없다. 그래서 굽어 둔 비트맵 두 장
   (이전 방향 · 새 방향)에 같은 회전의 **화면 좌표 변환**(`isoRotMat`)을 걸어
   교차 페이드한다. 두 변환은 같은 회전이라 건물과 지면이 어긋나지 않는다.
   교외에 구워 둔 집·나무만 전환 중 잠깐 기울어지는데, 0.3초짜리라 넘어간다. */
const ROT_FRAMES = 18;
let rot = null, prevGround = null, baking = false;

const rotEase = p => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));

/** 회전 시작. 새 방향으로 지면을 다시 굽고, 이전 지면은 전환 동안 붙잡아 둔다. */
function beginRotate(dir) {
  if (rot || !S || S.mode !== 'city') return;
  prevGround = cityGround();
  S.view = (((S.view | 0) + dir) % 4 + 4) % 4;
  ground = null;                                   // 새 방향으로 다시 굽는다
  rot = { dir, p: 0 };
}

function rotating() { return !!rot; }

/* ── 회전 ────────────────────────────────────────────────────
   모든 타일→월드 변환이 이 두 함수를 지난다. 여기서만 회전을 먹이면
   건물 배치·정렬·클릭 판정·차량 경로가 전부 같이 돈다.
   (건물 몸통은 prism 이 좌우 대칭이라 방향을 안 탄다 — 그래서 회전이 싸다) */
const viewOf = () => (S && S.view | 0) & 3;

/* 전환 중에는 실수 방향을 쓴다. **단 지면을 굽는 동안은 정수여야 한다** —
   중간 각도로 구우면 그 프레임의 그림이 통째로 캐시에 박힌다. */
function viewA() {
  if (!rot || baking) return viewOf();
  return viewOf() - rot.dir * (1 - rotEase(rot.p));
}

function cityX(O, gx, gy) { const [a, b] = rotGf(gx, gy, viewA(), MAP_W, MAP_H); return isoX(O, a, b); }

function cityY(O, gx, gy) { const [a, b] = rotGf(gx, gy, viewA(), MAP_W, MAP_H); return isoY(O, a, b); }

/** 구워 둔 지면을 a(타일 공간 각도)만큼 돌려 붙인다 */
function drawGroundRot(layer, a, alpha) {
  if (!layer || !layer.c || alpha <= 0) return;
  const px = CITY_O.x, py = CITY_O.y + (MAP_H - 1) * HH;   // 맵 한가운데 타일의 월드 좌표
  const m = isoRotMat(a);
  X.save();
  X.globalAlpha = Math.min(1, alpha);
  X.translate(px, py);
  X.transform(m[0], m[1], m[2], m[3], 0, 0);
  X.translate(-px, -py);
  X.drawImage(layer.c, -CITY_PAD_X, -CITY_PAD_Y);
  X.restore();
}

/* 상호판의 화면상 사각형. flushPlates 가 매 프레임 다시 채운다.
   상호판은 건물을 전부 그린 뒤 맨 위에 얹히므로 절대 가려지지 않는다.
   그래서 이걸 그대로 클릭 타깃으로 쓴다 — 뒤에 완전히 숨은 회사도 집을 수 있다. */
const plateBoxes = [];

/* ── 지면 캐시 ───────────────────────────────────────────── */
/* 타일 441장을 매 프레임 그리면 낭비다. 정지 화면이라 한 번 굽고 통째로 붙인다. */
function cityGround() {
  if (ground && builtFor === S && bakedView === viewOf()) return ground;
  builtFor = S; bakedView = viewOf();
  baking = true;
  buildEmpties();
  ensureTraffic();
  const LW = CITY_W + CITY_PAD_X * 2, LH = CITY_H + CITY_PAD_Y * 2;
  const O = { x: CITY_O.x + CITY_PAD_X, y: CITY_O.y + CITY_PAD_Y };
  const layer = makeLayer(LW, LH);
  const g = layer.ctx;
  if (g) {
    g.fillStyle = '#8FBE8C'; g.fillRect(0, 0, LW, LH);
    drawOutskirts(g, O, LW, LH);
    for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
      const x = cityX(O, gx, gy), y = cityY(O, gx, gy);
      let rx = isRoad(gx), ry = isRoad(gy);
      if (viewOf() & 1) [rx, ry] = [ry, rx];         // 홀수 뷰에서는 도로 방향이 바뀐다
      if (rx || ry) drawRoadTile(g, x, y, rx, ry);
      else drawBlockTile(g, x, y, gx, gy);
    }
  }
  baking = false;
  ground = layer;
  return ground;
}

/* ── 도시 밖 ─────────────────────────────────────────────────
   화면이 비어 보이던 원인은 도심 밖이 전부 논밭이었기 때문이다. 쿼터뷰 마름모는
   화면 사각형의 절반만 덮으므로 네 귀퉁이가 항상 남는데, 거기가 죄다 초록이면
   "도시가 조그맣게 떠 있는" 그림이 된다.

   그래서 거리에 따라 세 단으로 나눈다. 맵 경계에서
     0~5 타일  교외 주택가 — 도로가 이어지고 집·상가가 촘촘하다
     6~13 타일 마을 — 집이 성기고 논밭이 섞인다
     14 타일~  들판 — 논밭·숲·저수지

   전부 지면 레이어에 굽는다. 타일이 수천 장이어도 **프레임 비용은 0** 이다.
   ─────────────────────────────────────────────────────────── */
function drawOutskirts(g, O, LW, LH) {
  const R = 34;
  const inMap = (gx, gy) => gx >= 0 && gx < MAP_W && gy >= 0 && gy < MAP_H;
  const cell = (gx, gy) => h2((gx >> 2) * 31 + 7, (gy >> 2) * 17 + 3);

  /* 맵 경계까지의 체비셰프 거리. 도심에서 멀어지는 정도를 이걸로 잰다. */
  const edge = (gx, gy) => Math.max(
    gx < 0 ? -gx : gx >= MAP_W ? gx - MAP_W + 1 : 0,
    gy < 0 ? -gy : gy >= MAP_H ? gy - MAP_H + 1 : 0,
  );

  for (let pass = 0; pass < 2; pass++) {
    for (let gy = -R; gy < MAP_H + R; gy++) for (let gx = -R; gx < MAP_W + R; gx++) {
      if (inMap(gx, gy)) continue;
      const x = cityX(O, gx, gy), y = cityY(O, gx, gy);
      if (x < -36 || x > LW + 36 || y < -36 || y > LH + 36) continue;
      const ck = cell(gx, gy), r = h2(gx * 7 + 1, gy * 13 + 5);
      const d = edge(gx, gy);
      const road = d <= 13 && (gx % 4 === 0 || gy % 4 === 0);   // 교외 도로망

      if (pass === 0) {                                   // 바닥
        if (road) {
          rhomb(g, x, y, HW, HH, d <= 5 ? '#A8AEC2' : '#C2B894');
          rhombEdge(g, x, y, HW, HH, d <= 5 ? '#9298AE' : '#B0A684');
        } else if (d <= 5) {                              // 교외 — 포장된 마당
          rhomb(g, x, y, HW, HH, (gx + gy) % 2 ? '#AABE96' : '#A2B78E');
        } else if (ck < 0.16) {                           // 논밭 뙈기
          rhomb(g, x, y, HW, HH, r > 0.5 ? '#C7A97E' : '#BFA176');
          g.fillStyle = '#DCC094';
          for (let j = -9; j <= 9; j += 6) g.fillRect(Math.round(x - 12 + j), Math.round(y + j / 2), 24, 2);
        } else if (ck < 0.22) {                           // 저수지
          rhomb(g, x, y, HW, HH, '#8FC0DE');
        } else {
          rhomb(g, x, y, HW, HH, ck < 0.36 ? '#86B884' : (gx + gy) % 2 ? '#8CBE8A' : '#82B380');
        }
        continue;
      }

      if (road) continue;                                 // 도로 위에는 아무것도 안 올린다

      if (d <= 5) {                                       // 교외 주택가 — 촘촘하게
        if (r < 0.44) drawHouse(x, y - 3, r, g);
        else if (r < 0.52) drawShed(x, y, r, g);
        else if (r < 0.60) drawTree(x, y, r, g);
      } else if (d <= 13) {                               // 마을 — 성기게
        if (ck >= 0.22 && r < 0.17) drawHouse(x, y - 3, r * 5, g);
        else if (r < 0.24) drawTree(x, y, r * 4, g);
        else if (ck < 0.16 && r > 0.93) drawShed(x, y, 0.4, g);
      } else {                                            // 들판
        if (ck >= 0.22 && ck < 0.36 && r < 0.42) drawTree(x, y, r, g);
        else if (ck >= 0.36 && r < 0.05) drawTree(x, y, r * 12, g);
        else if (ck >= 0.36 && r > 0.985) drawHouse(x, y - 3, r, g);
        else if (ck < 0.16 && r > 0.97) drawShed(x, y, 0.4, g);
      }
    }
  }
}

/** 회사가 안 쓰는 블록에 지형을 배정한다. 좌표 해시라 매번 같은 결과가 나온다. */
function buildEmpties() {
  const used = new Set([`${S.co.lot.tx},${S.co.lot.ty}`, ...S.market.map(c => `${c.lot.tx},${c.lot.ty}`)]);
  empties = [];
  const N = BAL.cityBlocks;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const tx = 1 + i * BAL.blockPitch, ty = 1 + j * BAL.blockPitch;
    if (used.has(`${tx},${ty}`)) continue;
    empties.push({ tx, ty, kind: emptyKind(i, j, h2(tx, ty)) });
  }
}

function kindOf(tx, ty) {
  const e = empties.find(k => k.tx === tx && k.ty === ty);
  return e ? e.kind : 'company';
}

function drawRoadTile(g, x, y, rx, ry) {
  rhomb(g, x, y, HW, HH, rx && ry ? '#989EB2' : ROAD);
  rhombEdge(g, x, y, HW, HH, ROAD_EDGE);
  if (rx && ry) {                                   // 교차로 — 횡단보도
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = -12; i <= 12; i += 6) {
      g.fillRect(Math.round(x + i), Math.round(y - 8 - i / 2), 3, 3);
      g.fillRect(Math.round(x + i), Math.round(y + 5 - i / 2), 3, 3);
    }
    return;
  }
  g.fillStyle = 'rgba(255,248,214,.7)';            // 차선
  if (rx) { g.fillRect(Math.round(x - 8), Math.round(y - 2), 12, 2); g.fillRect(Math.round(x - 2), Math.round(y + 3), 9, 2); }
  else    { g.fillRect(Math.round(x - 5), Math.round(y + 2), 12, 2); g.fillRect(Math.round(x - 2), Math.round(y - 3), 9, 2); }
}

/* 블록 바닥 — 용도마다 색과 무늬가 다르다 */
function drawBlockTile(g, x, y, gx, gy) {
  const tx = blockOrigin(gx), ty = blockOrigin(gy);       // 블록 좌상단 타일
  const floor = KIND_FLOOR[kindOf(tx, ty)] || 'pave';
  if (floor === 'grass') { rhomb(g, x, y, HW, HH, '#93C790'); speckle(g, x, y, '#A6D6A0', 5); }
  else if (floor === 'soil') {
    rhomb(g, x, y, HW, HH, '#C7A97E');
    g.fillStyle = '#DCC094';
    for (let j = -9; j <= 9; j += 6) g.fillRect(Math.round(x - 12 + j), Math.round(y + j / 2), 24, 2);
  }
  else if (floor === 'yard') { rhomb(g, x, y, HW, HH, '#B2C498'); speckle(g, x, y, '#BED0A2', 3); }
  else if (floor === 'plaza') { rhomb(g, x, y, HW, HH, '#C2C8D6'); rhombEdge(g, x, y, HW, HH, '#AAB2C4'); }
  else if (floor === 'lot') { rhomb(g, x, y, HW, HH, '#AEB4C4'); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(Math.round(x - 12), Math.round(y - 3), 24, 2); }
  else { rhomb(g, x, y, HW, HH, WALK); rhombEdge(g, x, y, HW, HH, '#AFB8CC'); }
}

function speckle(g, x, y, color, n) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.fillRect(Math.round(x - 14 + h2(x + i * 20, y + i * 11) * 27), Math.round(y - 5 + h2(y, x + i) * 9), 3, 2);
  }
}

/* ── 차량 · 보행자 ───────────────────────────────────────── */
/* 도로가 3칸 간격이라 이동 축과 차선 번호만 있으면 위치가 나온다. */
function ensureTraffic() {
  /* 블록 사이 도로 두 줄을 차선으로 쓴다. 맨 바깥 둘레는 오프셋이 맵 밖으로 나가므로 뺀다. */
  const lanes = [];
  for (let n = 1; n < BAL.cityBlocks; n++) { lanes.push(n * BAL.blockPitch - 1); lanes.push(n * BAL.blockPitch); }
  /* 여기는 전부 **연출 스트림**이다. 차량이 몇 대 태어났는지가 게임 난수열을
     밀면, 지면을 다시 굽는 것만으로 그날의 인수 판정이 달라진다 (core/rng.js). */
  traffic = [];
  for (let i = 0; i < BAL.cityBlocks * 2; i++) {
    const kind = vchance(0.16) ? 'bus' : vchance(0.24) ? 'truck' : 'car';
    traffic.push({
      type: 'car', kind, axis: vchance(0.5) ? 'x' : 'y', lane: vpick(lanes),
      t: viewRand() * (MAP_W - 1), dir: vchance(0.5) ? 1 : -1, sp: vrnd(0.018, 0.04),
      c: kind === 'bus' ? vpick(['#93B8E0', '#8FCFB2'])
        : kind === 'truck' ? vpick(['#F5F2EA', '#C4C9D4'])
        : vpick(['#EE8C82', '#93B8E0', '#F5CE72', '#F5F2EA', '#8FCFB2', '#B79AD8']),
    });
  }
  for (let i = 0; i < BAL.cityBlocks * 2 + 2; i++) {
    traffic.push({
      type: 'ped', axis: vchance(0.5) ? 'x' : 'y', lane: vpick(lanes),
      t: viewRand() * (MAP_W - 1), dir: vchance(0.5) ? 1 : -1, sp: vrnd(0.006, 0.014),
      look: newLook(), walk: 0, off: vrnd(-0.34, 0.34),
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
  const long = t.kind === 'bus' ? 12 : t.kind === 'truck' ? 9 : 6;
  const h = t.kind === 'bus' ? 17 : 12, rx = 12, ry = 6;
  /* 차체를 진행 축으로 늘린다. 회전하면 화면상 진행 축도 바뀌므로 같이 돌린다. */
  const ne = rotFace(pedFace(t), viewOf()) === 'n' || rotFace(pedFace(t), viewOf()) === 's';
  const ox = long, oy = ne ? -long / 2 : long / 2;
  X.save(); X.globalAlpha = 0.14;
  rhomb(X, x + 3, y + 2, rx + long, (rx + long) / 2, '#000000'); X.restore();
  for (const s of [-1, 1]) {
    const cx = x + ox * s, cy = y + oy * s;
    prism(X, cx, cy, rx, ry, h, shade(t.c, 0.24), shade(t.c, -0.26), t.c);
  }
  prism(X, x, y, rx, ry, h, shade(t.c, 0.24), shade(t.c, -0.26), t.c);
  isoWin(X, x + ox, y + oy, rx, ry, 'r', 5, h - 8, 9, 6, '#5C6580');
  isoWin(X, x, y, rx, ry, 'l', 5, h - 8, 9, 6, '#56607A');
  X.fillStyle = '#FFEBA8'; X.fillRect(Math.round(x + ox + 6), Math.round(y + oy + 2), 3, 2);
}

/* ── 그리기 ──────────────────────────────────────────────── */
function drawCity() {
  const g = cityGround();
  if (rot) {
    const e = rotEase(rot.p), q = Math.PI / 2;
    drawGroundRot(prevGround, -rot.dir * e * q, 1 - e);      // 이전 방향이 빠져나가고
    drawGroundRot(g, rot.dir * (1 - e) * q, e);              // 새 방향이 들어온다
  } else if (g && g.c) {
    X.drawImage(g.c, -CITY_PAD_X, -CITY_PAD_Y);
  }
  moveTraffic();

  /* 쿼터뷰는 화면 아래쪽이 앞이다. 바닥 y 로 정렬해야 앞뒤가 맞는다. */
  const items = [];
  for (const c of S.market) items.push({ y: lotY(c.lot), box: bboxOf(bldgGeom(c)), f: () => drawBuilding(c) });
  items.push({ y: lotY(S.co.lot), box: bboxOf(myGeom()), f: drawMyBuilding });
  for (const e of empties) {
    const p = lotC(e);
    items.push({ y: lotY(e), box: bboxOf({ x: p.x, y: p.y, rx: 46, ry: 23, h: 66 }), f: () => drawTerrain(e) });
  }
  for (const t of traffic) {
    const p = trafficPos(t);
    const x = cityX(CITY_O, p.gx, p.gy), y = cityY(CITY_O, p.gx, p.gy);
    items.push({
      y,
      f: t.type === 'car' ? () => drawCar(t, x, y)
        : () => drawPerson(x, y, t.look, rotFace(pedFace(t), viewOf()), Math.floor(t.walk * 5)),
    });
  }
  items.sort((a, b) => a.y - b.y);
  const foc = focusOf();
  for (const it of items) {
    if (foc && it.box && it.y > foc.y && boxHits(it.box, foc.box)) {
      X.save(); X.globalAlpha = 0.14; it.f(); X.restore();   // 앞을 가리는 것만 눌러 준다
    } else it.f();
  }

  flushPlates();
  drawNegoMark();
  drawPops();

  if (rot && (rot.p += 1 / ROT_FRAMES) >= 1) { rot = null; prevGround = null; }
}

function lotY(lot) { return cityY(CITY_O, lot.tx + 1, lot.ty + 1); }

function lotC(lot) { return { x: cityX(CITY_O, lot.tx + 1, lot.ty + 1), y: lotY(lot) }; }

/* ── 지형 블록 ───────────────────────────────────────────── */
const FILL_BODY = ['#AFB8CC', '#C2C4D2', '#D2C6C0', '#BCCCD6', '#C6C0D4', '#D2CEB8'];

function drawTerrain(e) {
  const { x, y } = lotC(e);
  const k = h2(e.tx * 3, e.ty * 7);
  if (e.kind === 'office') return drawFillOffice(x, y, k, e);
  if (e.kind === 'apart') return drawFillApart(x, y, k, e);
  if (e.kind === 'shops') return drawFillShops(x, y, k, e);
  if (e.kind === 'park') {
    drawPond(x + 20, y + 5);
    for (const [dx, dy] of [[-27, -3], [-9, -14], [6, 11], [-20, 12]]) drawTree(x + dx, y + dy, h2(e.tx + dx, e.ty + dy));
    drawBench(x - 5, y + 2);
  } else if (e.kind === 'farm') {
    for (let i = 0; i < 5; i++) drawCrop(x - 30 + i * 14, y - 11 + i * 6);
    for (let i = 0; i < 4; i++) drawCrop(x - 9 + i * 14, y + 8 + i * 6);
    drawShed(x + 26, y - 8);
  } else if (e.kind === 'houses') {
    drawHouse(x - 23, y - 8, h2(e.tx, e.ty));
    drawHouse(x + 14, y + 5, h2(e.ty, e.tx));
    drawTree(x - 3, y + 17, 0.4);
  } else if (e.kind === 'plaza') {
    drawFountain(x, y);
    drawBench(x - 30, y + 3); drawBench(x + 27, y + 3);
    drawTree(x - 11, y - 17, 0.7); drawTree(x + 17, y - 14, 0.2);
  } else {
    for (let i = 0; i < 3; i++) {
      const c = ['#EE8C82', '#93B8E0', '#F5F2EA'][i];
      prism(X, x - 21 + i * 20, y - 11 + i * 9, 10, 5, 9, shade(c, 0.22), shade(c, -0.26), c);
    }
  }
}

/* 채움 오피스 — 인수 대상이 아니라 도시를 메우는 건물. 상호판이 없어
   플레이어 눈에 '클릭할 것'과 구분된다. */
function drawFillOffice(x, y, k, e) {
  const h = Math.round(39 + k * 51), rx = 36 + Math.round(k * 6) * 2, ry = rx / 2;
  const body = FILL_BODY[Math.floor(k * FILL_BODY.length)];
  X.save(); X.globalAlpha = 0.14; rhomb(X, x + 5, y + 3, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(body, 0.24), shade(body, -0.3), body);
  const rows = Math.floor((h - 18) / 11);
  for (let r = 0; r < rows; r++) for (let i = 0; i < 3; i++) {
    const lit = ((e.tx + e.ty + i * 3 + r * 5 + Math.floor(frame / 100)) % 6) < 2;
    const col = lit ? '#FFE79E' : '#7F8DAB';
    isoWin(X, x, y, rx, ry, 'l', 9 + i * 12, 9 + r * 11, 6, 6, shade(col, -0.16));
    isoWin(X, x, y, rx, ry, 'r', 9 + i * 12, 9 + r * 11, 6, 6, col);
  }
  drawRoofProps(x, y, h, rx, k);
}

/* 채움 아파트 — 층마다 발코니 띠가 있어 오피스와 실루엣이 갈린다 */
function drawFillApart(x, y, k, e) {
  const h = Math.round(45 + k * 45), rx = 34 + Math.round(k * 5) * 2, ry = rx / 2;
  const wall = k > 0.5 ? '#DCD5C6' : '#D0C9BA';
  X.save(); X.globalAlpha = 0.14; rhomb(X, x + 5, y + 3, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(wall, 0.22), shade(wall, -0.3), wall);
  for (let r = 0; r * 12 < h - 12; r++) {
    faces(X, x, y, rx, ry, 8 + r * 12, 12 + r * 12, shade(wall, -0.42), shade(wall, -0.24));   // 발코니
    for (let i = 0; i < 3; i++) {
      const lit = ((e.tx + i * 5 + r * 3 + Math.floor(frame / 120)) % 5) < 3;
      isoWin(X, x, y, rx, ry, 'r', 8 + i * 12, 12 + r * 12, 6, 6, lit ? '#FFEBA8' : '#8792AE');
    }
  }
  prism(X, x, y - h, rx + 4, (rx + 4) / 2, 3, '#C4C9D6', '#A2A8BA', '#B0B6C6');
  drawRoofProps(x, y, h + 3, rx, k);
}

/* 채움 상가 — 낮은 건물 두세 채가 붙어 있다 */
function drawFillShops(x, y, k, e) {
  const tint = ['#E39A88', '#95B8CE', '#B7A6CE', '#E3CB92', '#92C9AE'];
  for (let i = 0; i < 3; i++) {
    const kk = h2(e.tx + i * 11, e.ty + i * 5);
    const h = Math.round(20 + kk * 18);
    const cx = x - 24 + i * 24, cy = y - 12 + i * 12;
    const c = tint[Math.floor(kk * tint.length)];
    prism(X, cx, cy, 18, 9, h, '#F0E6CE', '#C8C0B0', '#DED6C2');
    faces(X, cx, cy, 18, 9, h - 6, h, shade(c, -0.34), c);                 // 간판
    isoWin(X, cx, cy, 18, 9, 'r', 5, 5, 9, 8, kk > 0.5 ? '#FFE79E' : '#B6D8EE');
  }
}

/* 옥상 소품 — 물탱크·실외기·광고탑·헬리패드. 스카이라인에 잔가지를 준다. */
function drawRoofProps(x, y, h, rx, k) {
  const top = y - h;
  if (k < 0.3) {                                          // 물탱크
    prism(X, x + 9, top + 3, 10, 5, 11, '#C0C6D2', '#A6ABBC', '#C2C8D6');
  } else if (k < 0.55) {                                  // 실외기 세 대
    for (let i = 0; i < 3; i++) prism(X, x - 12 + i * 12, top - 3 + i * 6, 6, 3, 6, '#CED3DC', '#B0B6C6', '#C0C6D2');
  } else if (k < 0.78) {                                  // 광고탑
    X.fillStyle = '#AAB2C4'; X.fillRect(Math.round(x - 8), Math.round(top - 18), 3, 18);
    X.fillStyle = '#AAB2C4'; X.fillRect(Math.round(x + 8), Math.round(top - 18), 3, 18);
    X.fillStyle = Math.floor(frame / 40) % 2 ? '#F5CE72' : '#D8B266';
    X.fillRect(Math.round(x - 11), Math.round(top - 27), 24, 11);
  } else {                                                // 헬리패드
    rhomb(X, x, top - 2, 16, 8, '#A2A8BA');
    X.fillStyle = '#F5F2EA';
    X.fillRect(Math.round(x - 5), Math.round(top - 6), 3, 9); X.fillRect(Math.round(x + 3), Math.round(top - 6), 3, 9);
    X.fillRect(Math.round(x - 3), Math.round(top - 3), 8, 3);
  }
}

/* 소품들은 메인 캔버스와 지면 레이어 양쪽에 그려야 하므로 컨텍스트를 받는다. */
function drawTree(x, y, r, g = X) {
  const big = r > 0.5;
  g.save(); g.globalAlpha = 0.13; rhomb(g, x + 2, y + 2, big ? 12 : 10, big ? 6 : 5, '#000000'); g.restore();
  g.fillStyle = '#9C7A5E'; g.fillRect(Math.round(x) - 2, Math.round(y) - 11, 5, 11);
  const c = big ? '#6FAE7C' : '#7EBC8A';
  prism(g, x, y - 11, big ? 16 : 12, big ? 8 : 6, big ? 15 : 12, shade(c, 0.32), shade(c, -0.24), c);
}

function drawBench(x, y) {
  prism(X, x, y, 12, 6, 5, '#D8BC96', '#B08A62', '#C2A282');
  X.fillStyle = '#B08A62'; X.fillRect(Math.round(x) - 11, Math.round(y) - 14, 3, 9);
}

function drawPond(x, y) {
  rhomb(X, x, y, 22, 11, '#8FC0DE');
  rhomb(X, x, y, 16, 8, '#A8D2EC');
  X.fillStyle = 'rgba(255,255,255,.26)'; X.fillRect(Math.round(x) - 8, Math.round(y) - 3, 9, 2);
}

function drawCrop(x, y) {
  X.fillStyle = '#9CC77E';
  for (let i = 0; i < 3; i++) X.fillRect(Math.round(x) + i * 5, Math.round(y) - 6 - (i % 2), 3, 8);
}

function drawShed(x, y, s, g = X) {
  const rx = s ? 12 : 16, h = s ? 11 : 12;
  prism(g, x, y, rx, (rx) / 2, h, '#C2A282', '#A08464', '#B89474');
  prism(g, x, y - h, rx + 2, (rx + 2) / 2, 5, '#EDA48E', '#C4766A', '#E39A88');
}

function drawHouse(x, y, r, g = X) {
  const wall = r > 0.5 ? '#F0E6CE' : '#E8D9BC';
  const roof = r > 0.66 ? '#E8A896' : r > 0.33 ? '#A6C4D8' : '#C6BBD8';
  prism(g, x, y, 18, 9, 18, shade(wall, 0.14), shade(wall, -0.26), wall);
  isoWin(g, x, y, 18, 9, 'r', 6, 6, 6, 6, '#FFE79E');
  isoWin(g, x, y, 18, 9, 'l', 6, 6, 6, 6, '#BEDCEE');
  prism(g, x, y - 18, 20, 10, 6, shade(roof, 0.22), shade(roof, -0.26), roof);
  rhomb(g, x, y - 30, 10, 5, shade(roof, 0.1));
}

function drawFountain(x, y) {
  rhomb(X, x, y, 24, 12, '#C0C6D2');
  rhomb(X, x, y, 18, 9, '#A8D2EC');
  prism(X, x, y, 6, 3, 12, '#CED3DC', '#C4C9D6', '#C4C9D4');
  X.fillStyle = 'rgba(198,220,255,.55)';
  const t = Math.round(Math.sin(frame / 14) * 3);
  X.fillRect(Math.round(x) - 2, Math.round(y) - 23 - t, 3, 11 + t);
}

/* ── 회사 건물 ───────────────────────────────────────────── */
/** 건물 한 채의 기하. 그리기와 클릭 판정이 같은 값을 써야 어긋나지 않는다. */
function bldgGeom(c) {
  const { x, y } = lotC(c.lot);
  const style = BLDG_STYLE[c.sector] || 'shop';
  const scale = Math.min(1, Math.max(0, (Math.log10(Math.max(10, c.cap)) - 7.6) / 5.4));
  const [h0, h1] = BLDG_H[style];
  const rx = style === 'plant' ? 46 : Math.round((30 + scale * 12) / 2) * 2;
  return { x, y, rx, ry: rx / 2, h: Math.round(h0 + scale * (h1 - h0)), style, scale };
}

function drawBuilding(c) {
  const g = bldgGeom(c);
  const sec = SECTORS[c.sector];
  const seed = c.lot.tx * 7 + c.lot.ty * 13;
  const body = c.owned ? '#A8CFB4' : mix(sec.color, '#F0EEE4', 0.30);
  const { x, y, rx, ry, h } = g;

  drawApron(x, y, c.lot);
  X.save(); X.globalAlpha = 0.15; rhomb(X, x + 5, y + 3, rx, ry, '#000000'); X.restore();
  prism(X, x, y, rx, ry, h, shade(body, 0.26), shade(body, -0.28), body);

  if (g.style === 'tower') drawTower(c, g, sec, seed, body);
  else if (g.style === 'lab') drawLab(c, g, sec);
  else if (g.style === 'plant') drawPlant(c, g);
  else if (g.style === 'neon') drawNeon(c, g, sec, seed);
  else drawShop(c, g, sec, seed);

  drawSign(x, y, rx, ry, sec, c.curse > 0);
  if (g.style === 'shop' || g.style === 'lab') drawRoofProps(x, y, h, rx, h2(c.lot.ty, c.lot.tx));

  if (c.owned) {                                        // 계열사 깃발
    X.fillStyle = '#E2E6F0'; X.fillRect(Math.round(x + rx - 14), Math.round(y - h - 21), 2, 18);
    X.fillStyle = '#F5CE72'; X.fillRect(Math.round(x + rx - 12), Math.round(y - h - 21), 11, 8);
  }
  if (c.curse > 0) {
    X.save(); X.globalAlpha = 0.18 + Math.sin(frame / 8) * 0.10;
    prism(X, x, y, rx, ry, h + 5, '#B79AD8', '#B79AD8', '#B79AD8'); X.restore();
  }
  if (hoverId === c.id) {
    X.save(); X.globalAlpha = 0.5 + Math.sin(frame / 10) * 0.2;
    rhombEdge(X, x, y - h, rx, ry, '#FFD57A'); rhombEdge(X, x, y, rx, ry, '#FFD57A'); X.restore();
  }
  drawNamePlate(x, y, c.name, c.owned ? '#FFD57A' : '#D6DAEA', { co: c, g });
}

/** 건물 앞 여백 — 주차 구획이나 화단 */
function drawApron(x, y, lot) {
  const k = h2(lot.tx * 5, lot.ty * 11);
  if (k < 0.4) {
    X.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 3; i++) X.fillRect(Math.round(x - 24 + i * 14), Math.round(y + 18 + i * 5), 9, 2);
  } else if (k < 0.72) {
    rhomb(X, x - 26, y + 12, 10, 5, '#6FAE7C');
    rhomb(X, x + 23, y + 14, 10, 5, '#6FAE7C');
  } else {
    X.fillStyle = '#AAB2C4';
    for (let i = 0; i < 4; i++) X.fillRect(Math.round(x - 17 + i * 8), Math.round(y + 17 + i), 2, 6);
  }
}

/* ── 건물 마감 프리미티브 (3단계 재작화) ────────────────────
   다섯 종이 공유하는 뼈대다. 새 해상도의 이득이 여기서 나온다 —
   32×16 시절엔 넣을 자리가 없던 기단·층 띠·창틀·파라펫·모서리 기둥이
   48×24 에서는 전부 들어간다. 종류별 함수는 이 위에 특징만 얹는다.

   `off` 는 면의 바깥 끝에서부터의 거리이고 **짝수여야** 벽에 붙는다 (RENDER.md §4).
   ─────────────────────────────────────────────────────────── */

/** 창 한 장 — 유리에 창틀을 두르고 아랫변에 반사를 넣는다 */
function pane(x, y, rx, ry, side, off, up, w, hgt, glass, frm) {
  isoWin(X, x, y, rx, ry, side, off - 2, up - 1, w + 4, hgt + 2, frm);
  isoWin(X, x, y, rx, ry, side, off, up, w, hgt, glass);
  isoWin(X, x, y, rx, ry, side, off, up, w, 1, shade(glass, 0.30));
}

/**
 * 창을 면 폭에 맞춰 고르게 배치한다.
 * **열 수를 rx 로 계산하는 게 핵심이다.** 열 자리를 상수로 박으면 작은 건물에서
 * 바깥 열이 `d > rx - 2` 로 잘려 나가 창이 두 개만 남는다 — 재작화 전 그림이
 * 휑했던 직접 원인이 이것이었다.
 */
function windowGrid(x, y, rx, ry, from, to, rowGap, ww, wh, colOf, frm) {
  const cols = clamp(Math.floor((rx - 10) / (ww + 4)), 2, 4);
  const step = ww + 6, span = (cols - 1) * step + ww;
  const start = Math.max(4, Math.round((rx - 2 - span) / 4) * 2);
  let r = 0;
  for (let up = from; up + wh <= to; up += rowGap, r++) {
    for (let i = 0; i < cols; i++) {
      const col = colOf(r, i);
      pane(x, y, rx, ry, 'l', start + i * step, up, ww, wh, shade(col, -0.16), shade(frm, -0.12));
      pane(x, y, rx, ry, 'r', start + i * step, up, ww, wh, col, frm);
    }
  }
}

/** 옥상 파라펫 — 테두리 한 겹. 없으면 상자를 잘라 놓은 것처럼 보인다 */
function parapet(x, y, rx, h, body) {
  prism(X, x, y - h, rx + 2, (rx + 2) / 2, 4, shade(body, 0.30), shade(body, -0.32), shade(body, 0.06));
}

/**
 * 옥상 바닥 — 파라펫 안쪽을 한 겹 깔고 설비를 얹는다.
 * 쿼터뷰는 지붕이 화면의 3분의 1을 먹는다. 여기가 빈 마름모 한 장이면
 * 아무리 벽을 잘 그려도 건물이 '잘라 놓은 상자'로 보인다.
 */
function roofDeck(x, y, rx, h, body, k) {
  const top = y - h - 4;
  rhomb(X, x, top, rx - 6, (rx - 6) / 2, shade(body, -0.10));
  rhombEdge(X, x, top, rx - 12, (rx - 12) / 2, shade(body, -0.20));
  prism(X, x - 10, top + 5, 8, 4, 8, '#D2D7E0', '#A6ABBC', '#C0C6D2');            // 물탱크
  for (let i = 0; i < 2; i++) {                                                    // 실외기
    prism(X, x + 6 + i * 9, top - 3 + i * 5, 5, 2, 4, '#CED3DC', '#A6ABBC', '#C0C6D2');
  }
  if (k > 0.6) rhomb(X, x + 2, top + 1, 12, 6, shade(body, -0.24));                // 채광창
}

/** 층 구분 띠 */
function floorBands(x, y, rx, ry, from, to, gap, body) {
  for (let up = from; up < to; up += gap) {
    faces(X, x, y, rx, ry, up, up + 2, shade(body, -0.30), shade(body, -0.14));
  }
}

/** 가까운 모서리의 세로 기둥. 두 면이 만나는 선을 살려 준다 */
function cornerPost(x, y, rx, ry, h, color) {
  X.fillStyle = color;
  X.fillRect(Math.round(x) - 2, Math.round(y) + ry - 1 - h, 4, h);
}

/** 면의 일부 구간에만 얹는 줄무늬 차양. 출입구·쇼윈도 위에 쓴다 */
function awning(x, y, rx, ry, side, off, w, up, a, b) {
  for (let i = 0; i < w; i += 2) {
    const d = off + i;
    if (d < 0 || d > rx - 2) continue;
    const px = side === 'l' ? x - rx + d : x + rx - d - 2;
    const by = side === 'l' ? y + ry - (rx - d) / 2 : y + ry - 1 - (rx - d - 2) / 2;
    X.fillStyle = (i >> 1) % 2 ? a : b;
    X.fillRect(Math.round(px), Math.round(by - up), 2, 4);
    X.fillStyle = 'rgba(64,56,79,.35)';
    X.fillRect(Math.round(px), Math.round(by - up + 4), 2, 1);
  }
}

/** 1층 — 돌 기단 · 간판띠 · 유리 출입문 · 차양. 모든 스타일이 공유한다. */
function drawSign(x, y, rx, ry, sec, cursed) {
  const c = cursed ? '#A88CB4' : sec.color;
  /* 1층은 **얇아야 한다.** 상가는 몸통이 33px 뿐이라 여기서 18px 를 쓰면
     창을 넣을 벽이 안 남는다. 기단 4 + 띠 9 + 립 2 = 15px 로 잡았다. */
  faces(X, x, y, rx, ry, 0, 4, '#B4BAC8', '#C8CEDA');                     // 돌 기단
  faces(X, x, y, rx, ry, 4, 13, shade(c, -0.30), c);                      // 간판띠
  faces(X, x, y, rx, ry, 13, 15, shade(c, 0.26), shade(c, 0.40));         // 띠 윗 립

  const d = rx - 22;                                                       // 출입구는 가까운 모서리 쪽
  pane(x, y, rx, ry, 'r', d, 4, 12, 8, '#B6D8EE', '#6E7788');
  isoWin(X, x, y, rx, ry, 'r', d + 4, 4, 2, 8, '#8E97A8');                 // 문틀 가운데
  awning(x, y, rx, ry, 'r', d - 2, 16, 14, shade(c, 0.34), '#F5F2EA');
}

/* ── 고층 (IT · 금융 · 전자) ─────────────────────────────────
   실루엣: 수직 멀리언으로 위로 뻗고, 높으면 옥탑이 한 단 물러난다. */
function drawTower(c, g, sec, seed, body) {
  const { x, y, rx, ry, h } = g;
  const glass = c.curse > 0 ? '#A890AC' : '#B6D8EE';
  const frm = shade(body, -0.34);
  const top = h - 10;

  floorBands(x, y, rx, ry, 16, top, 11, body);
  for (let i = 4; i < rx - 6; i += 12) {                                   // 수직 멀리언
    isoWin(X, x, y, rx, ry, 'l', i, 15, 2, Math.max(0, top - 15), shade(body, -0.22));
    isoWin(X, x, y, rx, ry, 'r', i, 15, 2, Math.max(0, top - 15), shade(body, -0.12));
  }
  windowGrid(x, y, rx, ry, 18, top, 11, 6, 7, (r, i) => {
    const lit = ((seed + i * 3 + r * 5 + Math.floor(frame / 90)) % 5) < 2;
    return c.curse > 0 ? '#A890AC' : lit ? '#FFE79E' : glass;
  }, frm);
  cornerPost(x, y, rx, ry, top, shade(body, 0.34));
  faces(X, x, y, rx, ry, top, top + 3, shade(sec.color, -0.34), shade(sec.color, -0.14));   // 상단 로고 띠
  parapet(x, y, rx, h, body);
  roofDeck(x, y, rx, h, body, ((seed % 10) / 10));

  if (h > 72) {                                                            // 물러난 옥탑
    const rr = rx - 14;
    prism(X, x, y - h - 4, rr, rr / 2, 14, shade(body, 0.32), shade(body, -0.26), body);
    faces(X, x, y - h - 4, rr, rr / 2, 10, 12, shade(body, -0.34), shade(body, -0.18));
    parapet(x, y - h - 4, rr, 14, body);
  }
  const ty = y - h - (h > 72 ? 22 : 4);
  X.fillStyle = '#E2E6F0'; X.fillRect(Math.round(x - 9), Math.round(ty - 24), 2, 24);       // 안테나
  X.fillStyle = Math.floor(frame / 30) % 2 ? '#EE8C82' : '#B06E68';                          // 항공장애등
  X.fillRect(Math.round(x - 11), Math.round(ty - 27), 5, 3);
}

/* ── 연구소 (제약) ───────────────────────────────────────────
   실루엣: 낮고 넓다. 가로로 긴 유리 띠와 흰 외벽. */
function drawLab(c, g, sec) {
  const { x, y, rx, ry, h } = g;
  const wall = '#EFEBDD', glass = c.curse > 0 ? '#A890AC' : '#B6D8EE';
  const top = h - 8;
  faces(X, x, y, rx, ry, 15, top, shade(wall, -0.12), wall);
  for (let up = 18; up + 9 <= top; up += 14) {                             // 가로 유리 띠
    pane(x, y, rx, ry, 'l', 8, up, rx - 16, 9, shade(glass, -0.18), '#9AA2B0');
    pane(x, y, rx, ry, 'r', 8, up, rx - 16, 9, glass, '#AEB6C4');
  }
  cornerPost(x, y, rx, ry, top, shade(wall, 0.16));
  faces(X, x, y, rx, ry, top, h, shade(sec.color, -0.26), shade(sec.color, -0.06));
  parapet(x, y, rx, h, wall);
  roofDeck(x, y, rx, h, wall, 0.9);
  rhomb(X, x + 6, y - h - 18, 12, 6, '#E2E6F0');                           // 접시 안테나
  X.fillStyle = '#AAB2C4'; X.fillRect(Math.round(x + 5), Math.round(y - h - 18), 2, 9);
}

/* ── 공장 (건설·중공업) ──────────────────────────────────────
   실루엣: 낮고 길다. 골판 외벽 + 톱니 지붕 + 굴뚝. */
function drawPlant(c, g) {
  const { x, y, rx, ry, h } = g;
  const wall = '#C4C9D4', glass = c.curse > 0 ? '#A890AC' : '#B6D8EE';
  const wallH = Math.max(0, h - 17);
  for (let i = 2; i < rx - 4; i += 6) {                                    // 골판 외벽
    isoWin(X, x, y, rx, ry, 'l', i, 15, 2, wallH, shade(wall, -0.24));
    isoWin(X, x, y, rx, ry, 'r', i, 15, 2, wallH, shade(wall, -0.12));
  }
  for (let i = 0; i < 3; i++) pane(x, y, rx, ry, 'r', 10 + i * 14, 17, 8, Math.min(9, wallH), glass, '#9AA2B0');
  pane(x, y, rx, ry, 'l', 8, 16, 18, Math.min(12, wallH), '#AEB6C4', '#8E97A8');   // 셔터
  cornerPost(x, y, rx, ry, h - 2, shade(wall, 0.24));

  for (let i = 0; i < 3; i++) {                                            // 톱니 지붕
    const sx = x - 22 + i * 22, sy = y - h - 11 + i * 11;
    prism(X, sx, sy, 14, 7, 10, '#C0C4D2', '#A6ABBC', '#C4C8D6');
    isoWin(X, sx, sy, 14, 7, 'r', 2, 3, 10, 6, glass);                     // 채광창
    faces(X, sx, sy, 14, 7, 10, 12, '#9CA2B4', '#AAB0C6');
  }
  const ch = Math.round(h * 0.7) + 14;
  prism(X, x - rx + 18, y - 6, 8, 4, ch, '#AFB8CC', '#9CA2B4', '#AAB0C6');  // 굴뚝
  X.fillStyle = '#EE8C82'; X.fillRect(Math.round(x - rx + 11), Math.round(y - 6 - ch + 8), 15, 5);
  const ct = y - 6 - ch;
  X.save(); X.globalAlpha = 0.16 + Math.sin(frame / 26) * 0.07;
  rhomb(X, x - rx + 18, ct - 9, 12, 6, '#E2E6F0');
  rhomb(X, x - rx + 26, ct - 21, 10, 5, '#E2E6F0'); X.restore();
}

/* ── 전광판 (미디어) ─────────────────────────────────────────
   실루엣: 벽 한 면이 통째로 화면이다. 네온 테두리가 깜빡인다. */
function drawNeon(c, g, sec, seed) {
  const { x, y, rx, ry, h } = g;
  const col = c.curse > 0 ? '#A890AC' : shade(sec.color, 0.05);
  const top = h - 8;
  const bh = Math.max(12, top - 20);
  isoWin(X, x, y, rx, ry, 'r', 4, 16, rx - 8, bh + 4, '#5C6580');           // 전광판 프레임
  isoWin(X, x, y, rx, ry, 'r', 6, 18, rx - 12, bh, col);
  for (let i = 0; i < 3; i++) {                                            // 흐르는 주사선
    const off = (Math.floor(frame / 6 + seed) + i * 9) % bh;
    isoWin(X, x, y, rx, ry, 'r', 6, 18 + off, rx - 12, 2, shade(col, 0.34));
  }
  isoWin(X, x, y, rx, ry, 'r', 6, 18 + Math.floor(frame / 12 + seed) % bh, rx - 12, 3, 'rgba(40,36,56,.45)');
  for (let i = 0; i < 4; i++) {                                            // 좌면 네온 세로등
    const on = (i + Math.floor(frame / 18)) % 3 === 0;
    isoWin(X, x, y, rx, ry, 'l', 8 + i * 10, 18, 6, bh, on ? '#FFE79E' : shade(sec.color, -0.16));
  }
  cornerPost(x, y, rx, ry, top, shade(sec.color, 0.36));
  const blink = Math.floor(frame / 20) % 2;
  faces(X, x, y, rx, ry, top, top + 3, blink ? shade(sec.color, 0.30) : shade(sec.color, -0.34),
        blink ? '#FFE79E' : shade(sec.color, -0.12));
  parapet(x, y, rx, h, sec.color);
  roofDeck(x, y, rx, h, shade(sec.color, -0.06), 0.2);
  X.fillStyle = '#AAB2C4'; X.fillRect(Math.round(x - 6), Math.round(y - h - 20), 3, 17);   // 광고탑
  X.fillStyle = Math.floor(frame / 24) % 2 ? '#FFE79E' : shade(sec.color, -0.20);
  X.fillRect(Math.round(x - 12), Math.round(y - h - 26), 16, 9);
}

/* ── 상가 (생필품·식품·유통·의류) ────────────────────────────
   실루엣: 낮고 통통하다. 큰 쇼윈도 + 차양 + 옥상 간판. */
function drawShop(c, g, sec, seed) {
  const { x, y, rx, ry, h } = g;
  const glass = c.curse > 0 ? '#A890AC' : '#B6D8EE';
  const top = h - 6;
  windowGrid(x, y, rx, ry, 18, top, 13, 8, 8, (r, i) => {
    const lit = ((seed + i * 3 + r * 5 + Math.floor(frame / 90)) % 5) < 3;
    return c.curse > 0 ? '#A890AC' : lit ? '#FFE79E' : glass;
  }, '#AEB6C4');
  awning(x, y, rx, ry, 'l', 6, rx - 10, 28, sec.color, '#F5F2EA');
  cornerPost(x, y, rx, ry, top, '#E4E0D4');
  faces(X, x, y, rx, ry, top, h, shade(sec.color, -0.40), shade(sec.color, -0.20));         // 처마
  const rr = rx + 4;
  prism(X, x, y - h, rr, rr / 2, 3, shade(sec.color, 0.24), shade(sec.color, -0.28), sec.color);
  prism(X, x - 2, y - h - 3, 14, 7, 10, '#F5F2EA', shade(sec.color, -0.30), shade(sec.color, 0.16));  // 옥상 간판
}

function drawNamePlate(x, y, name, color, hit) { plates.push({ x, y, name, color, hit }); }

function flushPlates() {
  plateBoxes.length = 0;
  for (const p of plates) {
    const w = Math.max(24, Math.round(textW(p.name, 10)) + 10), bh = 16;
    const x = Math.round(p.x - w / 2), y = Math.round(p.y + 21);
    const on = p.hit && (p.hit.self ? hoverId === '__me' : hoverId === p.hit.co.id);
    X.fillStyle = on ? 'rgba(11,15,27,.95)' : 'rgba(11,15,27,.82)';
    X.fillRect(x, y, w, bh);
    if (on) { X.fillStyle = '#FFD57A'; X.fillRect(x, y, w, 2); X.fillRect(x, y + bh - 2, w, 2); }
    drawText(p.x, p.y + 34, p.name, { size: 10, color: p.color, shadow: false });
    if (p.hit) plateBoxes.push({ x, y, w, h: bh, hit: p.hit });
  }
  plates.length = 0;
}

/* ── 플레이어 건물 — 등급마다 형태가 바뀐다 ──────────────── */
function drawMyBuilding() {
  const { x, y } = lotC(S.co.lot), tier = S.co.tier;
  const h = MY_H[tier], rx = MY_R[tier], ry = rx / 2;

  drawApron(x, y, S.co.lot);
  X.save(); X.globalAlpha = 0.17; rhomb(X, x + 5, y + 3, rx, ry, '#000000'); X.restore();

  if (tier === 0) {                                  // 구멍가게 — 박공지붕 주택
    prism(X, x, y, rx, ry, h, '#D8BC96', '#AA8A66', '#C2A282');
    isoWin(X, x, y, rx, ry, 'r', 6, 8, 9, 9, '#FFE79E');
    isoWin(X, x, y, rx, ry, 'l', 6, 8, 9, 9, '#BEDCEE');
    prism(X, x, y - h, rx + 4, (rx + 4) / 2, 6, '#EDA48E', '#C4766A', '#E39A88');
    rhomb(X, x, y - h - 17, 14, 7, '#E39A88');
  } else {
    const body = '#A6B0CC';
    prism(X, x, y, rx, ry, h, shade(body, 0.28), shade(body, -0.28), body);
    const rows = [0, 2, 3, 4, 5, 6, 7][tier];
    for (let r = 0; r < rows; r++) for (let i = 0; i < 2; i++) {
      const lit = ((i * 3 + r * 7 + Math.floor(frame / 70)) % 4) < 3;
      const col = lit ? '#FFEBA8' : '#7F8DAB';
      isoWin(X, x, y, rx, ry, 'l', 9 + i * 14, 21 + r * 12, 8, 8, shade(col, -0.14));
      isoWin(X, x, y, rx, ry, 'r', 9 + i * 14, 21 + r * 12, 8, 8, col);
    }
    faces(X, x, y, rx, ry, h - 6, h, '#E8C070', '#F5CE72');
    if (tier >= 4) prism(X, x + 9, y - h, 10, 5, 9, '#C0C6D2', '#A6ABBC', '#C4C8D6');
    if (tier >= 5) {
      X.fillStyle = '#E2E6F0'; X.fillRect(Math.round(x - 6), Math.round(y - h - 21), 2, 18);
      X.fillStyle = '#EE8C82'; X.fillRect(Math.round(x - 5), Math.round(y - h - 21), 12, 8);
    }
  }
  faces(X, x, y, rx, ry, 0, 12, '#D8B266', '#F5CE72');     // 금빛 1층
  isoWin(X, x, y, rx, ry, 'r', rx - 17, 0, 9, 11, '#5C6580');

  X.save(); X.globalAlpha = 0.35 + Math.sin(frame / 22) * 0.22;
  rhombEdge(X, x, y, rx + 6, (rx + 6) / 2, '#FFD57A'); X.restore();
  drawNamePlate(x, y, S.co.name, '#FFD57A', { self: true, g: myGeom() });
}

/* ── 협상 표시 ───────────────────────────────────────────── */
function drawNegoMark() {
  if (!S.nego) return;
  const t = S.market.find(c => c.id === S.nego.id);
  if (!t) return;
  const g = bldgGeom(t);
  const pl = Math.round(3 + Math.sin(frame / 12) * 3) * 2;
  X.save(); X.globalAlpha = 0.8;
  rhombEdge(X, g.x, g.y, 46 + pl, (46 + pl) / 2, '#8FBEEA'); X.restore();
  drawLabel(g.x, g.y - g.h - 21, `협상 ${Math.round(S.nego.progress)}%`, '#8FBEEA');
}

/* ── 클릭 판정 ───────────────────────────────────────────── */
/* 건물이 위로 솟아 있어 바닥 마름모만으로는 못 잡는다. 건물을 감싼 사각형을
   화면 앞(아래)에서부터 훑어 먼저 걸리는 것을 고른다. */
/* ── 클릭 판정 ───────────────────────────────────────────────
   쿼터뷰에서는 앞 건물이 뒤 건물을 덮어 클릭이 어렵다. 두 갈래로 푼다.

   ① 실루엣 판정 — 사각형 근사를 쓰면 건물 마름모 바깥 모서리(빈 하늘)까지
      앞 건물이 먹어 버린다. 마름모 기둥의 실제 실루엣으로 판정한다.
   ② 상호판 판정 — 그래도 완전히 가려진 회사는 남는다. 상호판은 항상 최상단에
      그려지므로, 상호판 자체를 클릭 타깃으로 삼아 '못 집는 회사'를 없앤다.
   ─────────────────────────────────────────────────────────── */

/** 마름모 기둥의 실루엣 판정. 그 x 에서의 세로 반경만큼만 인정한다. */
function isoHit(p, g) {
  const dx = Math.abs(p.x - g.x) / g.rx;
  if (dx > 1) return false;
  const band = (1 - dx) * g.ry;
  return p.y >= g.y - band - g.h && p.y <= g.y + band;
}

function plateHit(p) {
  for (let i = plateBoxes.length - 1; i >= 0; i--) {   // 나중에 그린 것이 위
    const b = plateBoxes[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.hit;
  }
  return null;
}

function cityHit(p) {
  const plate = plateHit(p);
  if (plate) return plate;
  const list = [
    ...S.market.map(c => ({ co: c, g: bldgGeom(c) })),
    { self: true, g: myGeom() },
  ].sort((a, b) => b.g.y - a.g.y);
  for (const it of list) if (isoHit(p, it.g)) return it;
  return null;
}

/* ── 가림 처리 ───────────────────────────────────────────────
   상호판으로 숨은 회사를 집을 수 있게 되면서, 정작 그 건물이 안 보이는 문제가
   생긴다. 호버 대상보다 앞에 있으면서 겹치는 것들을 반투명으로 눌러 준다.
   ─────────────────────────────────────────────────────────── */
function bboxOf(g) { return { l: g.x - g.rx, r: g.x + g.rx, t: g.y - g.h - g.ry, b: g.y + g.ry }; }

function boxHits(a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; }

/** 호버 중인 대상의 위치와 겉넓이. 없으면 null. */
function focusOf() {
  if (!hoverId) return null;
  let g = null;
  if (hoverId === '__me') g = myGeom();
  else { const c = S.market.find(m => m.id === hoverId); if (c) g = bldgGeom(c); }
  return g ? { y: g.y, box: bboxOf(g) } : null;
}

function myGeom() {
  const { x, y } = lotC(S.co.lot), rx = MY_R[S.co.tier];
  return { x, y, rx, ry: rx / 2, h: MY_H[S.co.tier] };
}

export { beginRotate, rotating, awning, cornerPost, floorBands, pane, parapet, roofDeck, windowGrid, isRoad, blockOrigin, bboxOf, boxHits, focusOf, isoHit, plateHit, bldgGeom, flushPlates, drawOutskirts, emptyKind, drawFillApart, drawFillOffice, drawFillShops, drawRoofProps, KIND_FLOOR, FILL_BODY, buildEmpties, cityGround, cityHit, drawApron, drawBench, drawBlockTile, drawBuilding, drawCar, drawCity, drawCrop, drawFountain, drawHouse, drawLab, drawMyBuilding, drawNamePlate, drawNegoMark, drawNeon, drawPlant, drawPond, drawRoadTile, drawShed, drawShop, drawSign, drawTerrain, drawTower, drawTree, ensureTraffic, h2, kindOf, lotC, lotY, moveTraffic, myGeom, pedFace, speckle, trafficPos };
