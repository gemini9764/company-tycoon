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

/**
 * 회전 애니메이션용 — view 를 **실수**로 받아 타일 좌표를 연속으로 돌린다.
 * 정수 view 에서는 `rotG` 와 정확히 같은 값이 나온다(90°씩이므로 검산됨).
 *
 * "2D 라 중간 각도를 못 그린다"고 봤던 게 틀렸다. 투영식은 그대로 두고
 * **타일 좌표만 연속으로 돌리면** 건물이 호를 그리며 제자리를 찾아간다.
 */
function rotGf(gx, gy, view, W, H) {
  const v = ((view % 4) + 4) % 4;
  if (Number.isInteger(v)) return rotG(gx, gy, v, W, H);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const a = -v * Math.PI / 2, s = Math.sin(a), c = Math.cos(a);
  const dx = gx - cx, dy = gy - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * 타일 좌표를 a 만큼 돌리는 것과 **같은 일을 하는 화면 좌표 선형변환**.
 * 지면 레이어는 프레임마다 다시 구울 수 없으므로, 구워 둔 비트맵에 이 행렬을
 * 걸어 돌린다. M = P·R(a)·P⁻¹ 를 풀면 [[cos, -k·sin], [sin/k, cos]] 이고
 * k = HW/HH = 2 다. 평평한 타일에 대해서는 기하학적으로 정확하다 —
 * 즉 호를 그리는 건물과 어긋나지 않는다.
 */
function isoRotMat(a) {
  const k = HW / HH, s = Math.sin(a), c = Math.cos(a);
  return [c, s / k, -k * s, c];        // ctx.transform(a, b, c, d, ...) 순서
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

/**
 * 경사 지붕(모임지붕). 상자 윗면에 얹어 실루엣을 만든다.
 *
 * 도시가 단조로워 보이던 가장 큰 이유는 **모든 건물이 평지붕 상자**여서
 * 위쪽 윤곽선이 전부 같은 마름모였기 때문이다. 꼭짓점 하나만 올려도
 * 스카이라인이 살아난다.
 *
 * 남쪽에서는 네 면 중 좌하·우하 둘만 보이므로 삼각형 두 장만 그린다.
 * 각 면은 처마(기울기 ry/rx)와 추녀마루(꼭짓점으로 올라가는 선) 사이를
 * 2px 세로 기둥으로 채운다 — 엔진의 다른 도형과 같은 방식이라 도트가 뭉개지지 않는다.
 */
function isoRoof(X, cx, cy, rx, ry, rise, left, right, ridge) {
  cx = Math.round(cx); cy = Math.round(cy);
  for (const side of [-1, 1]) {
    X.fillStyle = side < 0 ? left : right;
    for (let i = 0; i < rx; i += 2) {
      const t = side < 0 ? (i + 2) / rx : (rx - i) / rx;   // 처마 끝 0 → 꼭짓점 1
      const x = side < 0 ? cx - rx + i : cx + i;
      const top = Math.round(cy - rise * t), bot = Math.round(cy + ry * t);
      X.fillRect(x, top, 2, Math.max(1, bot - top));
    }
  }
  if (ridge) {                                   // 추녀마루 하이라이트
    X.fillStyle = ridge;
    for (let i = 0; i < rx; i += 2) {
      const t = (i + 2) / rx;
      X.fillRect(cx - rx + i, Math.round(cy - rise * t), 2, 1);
      X.fillRect(cx + rx - i - 2, Math.round(cy - rise * t), 2, 1);
    }
  }
}

/**
 * 얇은 벽. 상자(prism)로 벽을 세우면 **타일 한 칸을 통째로** 차지해 두껍다.
 * `prism` 의 반지름을 줄이면 두께뿐 아니라 길이도 같이 줄어 타일 사이에 틈이
 * 벌어지므로, 벽에는 별도 도형이 필요하다.
 *
 * 윗면은 평행사변형이다 — 벽을 따라가는 두 변은 기울기 +0.5 로 나란하고,
 * 두께 쪽 두 변은 -0.5 다. 그래서 한 열(x)마다 위아래 y 만 구하면 채울 수 있다.
 *   윗변  y = -HH + |x|/2
 *   아랫변 y = min( (2t-1)·HH + x/2 , (HW - x)/2 )
 * 앞쪽은 벽을 따라가는 안쪽 면, 뒤쪽은 끝면이라 색을 달리한다.
 *
 * @param {number} t   두께 비율 (1 이면 예전 상자와 같다)
 * @param {number} dir +1 이면 gy 가 작은 쪽(북동 벽), -1 이면 좌우를 뒤집는다
 */
function slab(X, cx, cy, h, t, dir, top, inner, end) {
  cx = Math.round(cx); cy = Math.round(cy);
  const x0 = -Math.round(t * HW), edge = (1 - t) * HW;
  for (let x = x0; x < HW; x += 2) {
    const yt = -HH + Math.abs(x) / 2;
    const dc = (2 * t - 1) * HH + x / 2;             // 안쪽 긴 변
    const bc = (HW - x) / 2;                          // 끝면 변
    const yb = Math.min(dc, bc);
    if (yb <= yt) continue;
    const sx = Math.round(cx + (dir < 0 ? -x - 2 : x));
    X.fillStyle = x < edge ? inner : end;             // 몸통
    X.fillRect(sx, Math.round(cy + yb - h), 2, Math.max(1, Math.round(h)));
    X.fillStyle = top;                                // 윗면
    X.fillRect(sx, Math.round(cy + yt - h), 2, Math.max(1, Math.round(yb - yt)));
  }
}

/** 얇은 벽의 띠(걸레받이·몰딩). 벽 안쪽 면에만 얹는다 */
function slabBand(X, cx, cy, t, dir, up, hi, col) {
  cx = Math.round(cx); cy = Math.round(cy);
  const x0 = -Math.round(t * HW), edge = (1 - t) * HW;
  X.fillStyle = col;
  for (let x = x0; x < edge; x += 2) {
    const yb = (2 * t - 1) * HH + x / 2;
    const sx = Math.round(cx + (dir < 0 ? -x - 2 : x));
    X.fillRect(sx, Math.round(cy + yb - hi), 2, Math.max(1, hi - up));
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

export { FACES4, HH, HW, TH, TW, depth, isoRotMat, rotFace, rotG, rotGf, faces, isoRoof, isoShadow, isoWin, slab, slabBand, isoX, isoY, makeLayer, prism, rhomb, rhombEdge, unIso };
