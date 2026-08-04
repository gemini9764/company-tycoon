/* ══════════════════════════════════════════════════════════════
   ISO — 쿼터뷰 투영과 도형 프리미티브

   2:1 아이소메트릭. 타일 한 장은 가로 48 세로 24 마름모다.
   `ctx.fill(path)` 로 마름모를 그리면 사선이 안티에일리어싱되어 도트가 아니게
   된다. 그래서 모든 도형을 fillRect 로 계단을 직접 쌓아 올린다.
   ══════════════════════════════════════════════════════════════ */
const TW = 48, TH = 24;          // 타일 마름모 크기 (GRAPHICS.md 2단계 — B안)
const HW = TW / 2, HH = TH / 2;  // 타일 한 칸 이동량

/** 타일 좌표 → 월드 좌표. o 는 맵 원점 {x, y}. */
function isoX(o, gx, gy) { return o.x + (gx - gy) * HW; }

function isoY(o, gx, gy) { return o.y + (gx + gy) * HH; }

/** 월드 좌표 → 타일 좌표(실수). 클릭 판정에 쓴다. */
function unIso(o, wx, wy) {
  const dx = (wx - o.x) / HW, dy = (wy - o.y) / HH;
  return { gx: (dy + dx) / 2, gy: (dy - dx) / 2 };
}

/* ── 회전 ────────────────────────────────────────────────────
   쿼터뷰에서 90° 회전은 투영식을 건드릴 필요가 없다. **타일 좌표만 돌리면**
   화면이 따라 돈다. 그리는 쪽과 판정하는 쪽이 이 함수 하나를 같이 쓰면
   클릭 판정은 저절로 맞는다.

   view 0 = 기본, 1·2·3 = 시계 방향 90°씩. 실수 좌표(차량·보행자)도 그대로 통한다. */
function rotG(gx, gy, view, W, H) {
  switch (view & 3) {
    case 1: return [gy, W - 1 - gx];
    case 2: return [W - 1 - gx, H - 1 - gy];
    case 3: return [H - 1 - gy, gx];
    default: return [gx, gy];
  }
}

/* 보행자·차량이 향한 쪽. 화면 기준 라벨이라 회전하면 같이 돌아야 한다.
   'e' 우하(SE) · 's' 좌하(SW) · 'w' 좌상(NW) · 'n' 우상(NE) — 반시계 순서다. */
const FACES4 = ['e', 's', 'w', 'n'];

function rotFace(face, view) {
  const i = FACES4.indexOf(face);
  return i < 0 ? face : FACES4[(i - view + 8) & 3];
}

/** 그리는 순서. 값이 작을수록 뒤(먼저 그림). */
function depth(gx, gy) { return gx + gy; }

/* ── 도형 ────────────────────────────────────────────────── */

/** 마름모 한 장. rx = 2*ry 여야 2:1 기울기가 나온다. */
function rhomb(X, cx, cy, rx, ry, color) {
  X.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  for (let i = 0; i < ry; i++) {
    const w = (i + 1) * (rx / ry) * 2;
    X.fillRect(cx - w / 2, cy - ry + i, w, 1);
    X.fillRect(cx - w / 2, cy + ry - 1 - i, w, 1);
  }
}

/** 마름모 테두리 — 타일 경계선이나 구획 표시용 */
function rhombEdge(X, cx, cy, rx, ry, color) {
  X.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  for (let i = 0; i < ry; i++) {
    const hw = (i + 1) * (rx / ry);
    X.fillRect(cx - hw, cy - ry + i, 2, 1);      // 좌상
    X.fillRect(cx + hw - 2, cy - ry + i, 2, 1);  // 우상
    X.fillRect(cx - hw, cy + ry - 1 - i, 2, 1);  // 좌하
    X.fillRect(cx + hw - 2, cy + ry - 1 - i, 2, 1);
  }
}

/**
 * 두 옆면을 바닥 기준 높이 from~to 구간만 칠한다. 간판띠·창문줄처럼
 * 벽의 일부만 다른 색으로 두를 때 쓴다.
 */
function faces(X, cx, cy, rx, ry, from, to, left, right) {
  const h = to - from;
  if (h <= 0) return;
  cx = Math.round(cx); cy = Math.round(cy);
  X.fillStyle = left;
  for (let x = cx - rx; x <= cx - 2; x += 2) {
    X.fillRect(x, cy + ry - (cx - x) / 2 - to, 2, h);
  }
  X.fillStyle = right;
  for (let x = cx; x <= cx + rx - 2; x += 2) {
    X.fillRect(x, cy + ry - 1 - (x - cx) / 2 - to, 2, h);
  }
}

/**
 * 상자. (cx, cy)는 바닥 마름모의 중심, h 는 높이.
 * 남쪽에서 보므로 좌하(SW)·우하(SE) 두 면과 윗면이 보인다.
 */
function prism(X, cx, cy, rx, ry, h, top, left, right) {
  h = Math.round(h);
  faces(X, cx, cy, rx, ry, 0, h, left, right);
  if (top) rhomb(X, Math.round(cx), Math.round(cy) - h, rx, ry, top);
}

/**
 * 옆면에 붙는 창문 한 장. 면이 기울어 있으므로 2px 세로줄을 한 칸씩
 * 어긋나게 쌓아야 벽에 붙어 보인다.
 * @param side 'l' 좌하면 / 'r' 우하면
 * @param off  면의 바깥 끝에서부터의 거리(짝수)
 * @param up   바닥에서 창문 아랫변까지의 높이
 */
function isoWin(X, cx, cy, rx, ry, side, off, up, w, h, color) {
  X.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy);
  for (let i = 0; i < w; i += 2) {
    const d = off + i;
    if (d < 0 || d > rx - 2) continue;
    const x = side === 'l' ? cx - rx + d : cx + rx - d - 2;
    const by = side === 'l' ? cy + ry - (rx - d) / 2 : cy + ry - 1 - (rx - d - 2) / 2;
    X.fillRect(x, by - up - h, 2, h);
  }
}

/** 바닥에 깔리는 그림자. 상자 밑동을 어둡게 눌러 준다. */
function isoShadow(X, cx, cy, rx, ry) {
  X.save();
  X.globalAlpha = 0.22;
  rhomb(X, cx + 2, cy + 1, rx, ry, '#000000');
  X.restore();
}

/* ── 지면 캐시 ───────────────────────────────────────────── */
/* 지면 타일은 프레임마다 수백 장이 나온다. 정지 화면이므로 한 번 그려 두고
   매 프레임 통째로 붙인다. 캔버스가 없는 환경(jsdom)에서는 조용히 건너뛴다. */
function makeLayer(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export { FACES4, HH, HW, TH, TW, depth, rotFace, rotG, faces, isoShadow, isoWin, isoX, isoY, makeLayer, prism, rhomb, rhombEdge, unIso };
