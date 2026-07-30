import { SECTORS } from '../core/data.js';
import { S } from '../core/state.js';
import { $ } from '../core/util.js';
import { CITY_H, CITY_W, MAP_H, MAP_W, T, X, cars, drawLabel, drawPops, frame, hoverId, lotRect, shade, walkers } from './canvas.js';

/* ── 도시 맵 ─────────────────────────────────────────────── */
function drawCity() {
  // 지면
  X.fillStyle = '#2C3550'; X.fillRect(0, 0, CITY_W, CITY_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const road = x % 3 === 0 || y % 3 === 0;
    if (road) {
      X.fillStyle = (x % 3 === 0 && y % 3 === 0) ? '#3B4463' : '#39415F';
      X.fillRect(x * T, y * T, T, T);
      X.fillStyle = 'rgba(242,178,51,.16)';
      if (x % 3 === 0 && y % 3 !== 0) X.fillRect(x * T + 15, y * T + 6, 2, 8), X.fillRect(x * T + 15, y * T + 20, 2, 8);
      if (y % 3 === 0 && x % 3 !== 0) X.fillRect(x * T + 6, y * T + 15, 8, 2), X.fillRect(x * T + 20, y * T + 15, 8, 2);
    } else {
      X.fillStyle = '#243052'; X.fillRect(x * T, y * T, T, T);
    }
  }
  drawCars(); drawWalkers();

  // NPC 건물 (뒤→앞 정렬)
  const list = [...S.market].sort((a, b) => a.lot.ty - b.lot.ty);
  for (const c of list) drawBuilding(c);
  drawMyBuilding();

  // 진행 중 협상 표시
  if (S.nego) {
    const t = S.market.find(c => c.id === S.nego.id);
    if (t) {
      const r = lotRect(t.lot), pl = 2 + Math.sin(frame / 12) * 2;
      X.strokeStyle = '#4A86C7'; X.lineWidth = 2;
      X.strokeRect(r.x - pl, r.y - pl - 10, r.w + pl * 2, r.h + pl * 2 + 10);
      drawLabel(r.x + r.w / 2, r.y - 16, `협상 ${Math.round(S.nego.progress)}%`, '#4A86C7');
    }
  }
  drawPops();
}

function drawCars() {
  const lanes = [3, 6, 9, 12, 15];
  for (const c of cars) {
    c.t += 0.0016 * c.dir * (S.speed || 1);
    if (c.t > 1) c.t = 0; if (c.t < 0) c.t = 1;
    const x = lanes[c.lane] * T + 12, y = c.t * CITY_H;
    X.fillStyle = c.c; X.fillRect(x, y, 7, 12);
    X.fillStyle = 'rgba(0,0,0,.35)'; X.fillRect(x, y + (c.dir > 0 ? 9 : 0), 7, 3);
  }
}

function drawWalkers() {
  const lanes = [0, 3, 6, 9, 12];
  for (const w of walkers) {
    w.t += w.s * w.dir * (S.speed || 1);
    if (w.t > 1) w.t = 0; if (w.t < 0) w.t = 1;
    const bob = Math.floor(frame / 9 + w.t * 40) % 2;
    let x, y;
    if (w.axis === 'v') { x = lanes[w.lane] * T + 24; y = w.t * CITY_H; }
    else { x = w.t * CITY_W; y = lanes[w.lane % 5] * T + 24; }
    X.fillStyle = '#1A2038'; X.fillRect(x, y + 5, 4, 3);
    X.fillStyle = w.c; X.fillRect(x, y, 4, 5 + bob);
  }
}

/* NPC 건물 */
function drawBuilding(c) {
  const r = lotRect(c.lot);
  const sec = SECTORS[c.sector];
  const h = 26 + Math.min(30, Math.log10(Math.max(10, c.cap)) * 2.4);
  const bx = r.x + 6, by = r.y + r.h - h - 6, bw = r.w - 12, bh = h;

  X.fillStyle = 'rgba(0,0,0,.32)'; X.fillRect(bx + 3, by + bh - 3, bw, 6);
  X.fillStyle = c.owned ? '#3E5A48' : '#4A5273'; X.fillRect(bx, by, bw, bh);           // 몸통
  X.fillStyle = c.owned ? '#54785E' : shade(sec.color, -0.35); X.fillRect(bx, by, bw, 6); // 옥상
  X.fillStyle = sec.color; X.fillRect(bx, by + bh - 8, bw, 8);                          // 간판띠

  // 창문
  const cols = Math.floor((bw - 6) / 8), rows = Math.floor((bh - 18) / 8);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const lit = ((c.lot.tx * 7 + c.lot.ty * 13 + i * 3 + j * 5 + Math.floor(frame / 90)) % 5) < 2;
    X.fillStyle = c.curse > 0 ? '#5A3B52' : lit ? '#F2E2A8' : '#2C3550';
    X.fillRect(bx + 4 + i * 8, by + 9 + j * 8, 5, 5);
  }
  // 문
  X.fillStyle = '#2C3550'; X.fillRect(bx + bw / 2 - 4, by + bh - 8, 8, 8);

  if (c.owned) { // 계열사 배지
    X.fillStyle = '#F2B233'; X.fillRect(bx + bw - 10, by - 7, 9, 7);
    X.fillStyle = '#161A2B'; X.fillRect(bx + bw - 8, by - 5, 2, 3); X.fillRect(bx + bw - 4, by - 5, 2, 3);
  }
  if (c.curse > 0) { // 살 이펙트
    X.fillStyle = `rgba(139,92,184,${0.25 + Math.sin(frame / 8) * 0.12})`;
    X.fillRect(bx - 2, by - 4, bw + 4, bh + 4);
  }
  if (hoverId === c.id) { X.strokeStyle = '#F2B233'; X.lineWidth = 2; X.strokeRect(bx - 2, by - 2, bw + 4, bh + 4); }

  // 상호
  X.font = '7px "Galmuri9",monospace'; X.textAlign = 'center';
  X.fillStyle = 'rgba(0,0,0,.55)'; X.fillRect(r.x, r.y + r.h - 5, r.w, 9);
  X.fillStyle = c.owned ? '#F2B233' : '#C6CCE2';
  X.fillText(c.name, r.x + r.w / 2, r.y + r.h + 2);
  X.textAlign = 'left';
}

/* 플레이어 건물 — 등급에 따라 형태 변화 */
function drawMyBuilding() {
  const r = lotRect(S.co.lot), tier = S.co.tier;
  const h = [22, 30, 40, 50, 60, 70, 78][tier];
  const bw = [34, 40, 46, 50, 50, 52, 54][tier];
  const bx = r.x + (r.w - bw) / 2, by = r.y + r.h - h - 6;

  X.fillStyle = 'rgba(0,0,0,.4)'; X.fillRect(bx + 3, by + h - 3, bw, 7);

  if (tier === 0) {            // 구멍가게 — 주택 형태
    X.fillStyle = '#8A6A4A'; X.fillRect(bx, by + 8, bw, h - 8);
    X.fillStyle = '#C4553F'; // 박공지붕
    for (let i = 0; i < 9; i++) X.fillRect(bx + i * 2, by + 8 - i, bw - i * 4, 2);
    X.fillStyle = '#F2E2A8'; X.fillRect(bx + 5, by + 14, 8, 7);
    X.fillStyle = '#4A3728'; X.fillRect(bx + bw - 14, by + h - 12, 10, 12);
  } else {                     // 등급별 층수 건물
    X.fillStyle = '#4A5273'; X.fillRect(bx, by, bw, h);
    X.fillStyle = '#F2B233'; X.fillRect(bx, by, bw, 5);
    const floors = [0, 2, 3, 4, 5, 6, 7][tier];
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < Math.floor((bw - 8) / 9); i++) {
        const lit = ((i * 3 + f * 7 + Math.floor(frame / 70)) % 4) < 3;
        X.fillStyle = lit ? '#FFE9A8' : '#2C3550';
        X.fillRect(bx + 5 + i * 9, by + 10 + f * 8, 6, 5);
      }
    }
    X.fillStyle = '#2C3550'; X.fillRect(bx + bw / 2 - 6, by + h - 10, 12, 10);
    if (tier >= 5) { X.fillStyle = '#C6CCE2'; X.fillRect(bx + bw / 2 - 1, by - 12, 2, 12);
                     X.fillStyle = '#D0453B'; X.fillRect(bx + bw / 2 + 1, by - 12, 7, 4); }
  }
  // 깃발 + 강조
  const gl = 0.5 + Math.sin(frame / 22) * 0.2;
  X.strokeStyle = `rgba(242,178,51,${gl})`; X.lineWidth = 2;
  X.strokeRect(bx - 3, by - 3, bw + 6, h + 6);

  X.font = '7px "Galmuri9",monospace'; X.textAlign = 'center';
  X.fillStyle = 'rgba(0,0,0,.6)'; X.fillRect(r.x - 4, r.y + r.h - 5, r.w + 8, 9);
  X.fillStyle = '#F2B233'; X.fillText(S.co.name, r.x + r.w / 2, r.y + r.h + 2);
  X.textAlign = 'left';
}

export { drawBuilding, drawCars, drawCity, drawMyBuilding, drawWalkers };
