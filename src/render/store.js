import { SECTORS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, clamp, pick, rint, rnd, won } from '../core/util.js';
import { STORE_H, STORE_W, X, customers, drawPerson, drawPops, frame, pops } from './canvas.js';
import { dailyRetail } from '../systems/economy.js';

/* ── 매장 내부 (경영 모드) ───────────────────────────────── */
const SHELVES = [{ x: 40, y: 70 }, { x: 120, y: 70 }, { x: 200, y: 70 }, { x: 40, y: 128 }, { x: 120, y: 128 }, { x: 200, y: 128 }];

const COUNTER = { x: 262, y: 96 };

const DOOR = { x: 160, y: 200 };

function spawnCustomers() {
  customers.length = 0;
  for (let i = 0; i < 6; i++) customers.push(newCustomer());
}

function newCustomer() {
  const sh = pick(SHELVES);
  return {
    x: DOOR.x + rnd(-14, 14), y: STORE_H + rnd(0, 30),
    tx: sh.x + 8, ty: sh.y + 26, phase: 'shelf', wait: 0,
    c: pick(['#E8C39E','#C98A64','#F0D9B5','#D4A574']),
    s: pick(['#4A86C7','#D0453B','#2FA37A','#8B5CB8','#F2B233','#E8E4D8']),
    sp: rnd(0.45, 0.85),
  };
}

function drawStore() {
  // 바닥
  X.fillStyle = '#C9BC9B'; X.fillRect(0, 0, STORE_W, STORE_H);
  for (let y = 0; y < STORE_H; y += 16) for (let x = 0; x < STORE_W; x += 16)
    if ((x / 16 + y / 16) % 2 === 0) { X.fillStyle = '#BFB08B'; X.fillRect(x, y, 16, 16); }
  // 벽
  X.fillStyle = '#6B5B47'; X.fillRect(0, 0, STORE_W, 34);
  X.fillStyle = '#7D6B53'; X.fillRect(0, 30, STORE_W, 4);
  X.fillStyle = '#3A3020'; X.fillRect(0, 0, STORE_W, 5);
  // 간판
  X.fillStyle = '#161A2B'; X.fillRect(70, 8, 180, 18);
  X.fillStyle = '#F2B233'; X.fillRect(70, 8, 180, 3);
  X.font = '10px "Galmuri11",monospace'; X.textAlign = 'center';
  X.fillStyle = '#F5EFDD'; X.fillText(S.co.name, 160, 22);
  // 출입문
  X.fillStyle = '#4A3728'; X.fillRect(DOOR.x - 20, STORE_H - 6, 40, 6);
  X.fillStyle = '#8AB4D8'; X.fillRect(DOOR.x - 17, STORE_H - 5, 34, 4);

  // 진열대 — 인수한 업종만큼 상품 색이 늘어난다
  const palette = ['#7FB069', ...S.co.subs.slice(0, 5).map(s => SECTORS[s.sector].color)];
  SHELVES.forEach((sh, i) => {
    X.fillStyle = 'rgba(0,0,0,.2)'; X.fillRect(sh.x + 2, sh.y + 26, 56, 4);
    X.fillStyle = '#8A6A4A'; X.fillRect(sh.x, sh.y, 58, 28);
    X.fillStyle = '#6B5136'; X.fillRect(sh.x, sh.y + 13, 58, 3);
    for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) {
      X.fillStyle = palette[(i + r + k) % palette.length];
      X.fillRect(sh.x + 3 + k * 9, sh.y + 3 + r * 13, 7, 9);
    }
  });

  // 계산대 + 직원
  X.fillStyle = 'rgba(0,0,0,.2)'; X.fillRect(COUNTER.x + 2, COUNTER.y + 34, 44, 4);
  X.fillStyle = '#5A6B8C'; X.fillRect(COUNTER.x, COUNTER.y, 44, 36);
  X.fillStyle = '#7186AD'; X.fillRect(COUNTER.x, COUNTER.y, 44, 6);
  X.fillStyle = '#161A2B'; X.fillRect(COUNTER.x + 6, COUNTER.y + 12, 14, 10);
  drawPerson(COUNTER.x + 32, COUNTER.y - 6, '#E8C39E', '#F2B233', 0);

  // 직원 스프라이트 (최대 4명, 진열대 주변 배회)
  S.staff.slice(0, 4).forEach((e, i) => {
    const a = frame / 130 + i * 1.7;
    drawPerson(52 + i * 62 + Math.sin(a) * 16, 50 + Math.cos(a * 1.3) * 6, '#F0D9B5', e.onTeam ? '#4A86C7' : '#8A8F9E', Math.floor(frame / 12 + i) % 2);
  });

  updateCustomers();
  drawPops();

  // 하단 상태 스트립
  X.fillStyle = 'rgba(22,26,43,.86)'; X.fillRect(0, STORE_H - 20, STORE_W, 14);
  X.font = '8px "Galmuri9",monospace'; X.textAlign = 'left';
  X.fillStyle = '#F5EFDD';
  X.fillText(`일매출 ${won(S.co.revToday)}`, 6, STORE_H - 10);
  X.fillStyle = '#2FA37A';
  X.fillText(`순익 ${won(S.co.revToday - S.co.costToday)}`, 104, STORE_H - 10);
  X.fillStyle = '#F2B233';
  X.fillText(`인지도 ×${S.co.marketing.toFixed(2)}`, 200, STORE_H - 10);
}

function updateCustomers() {
  const want = clamp(4 + Math.round(S.co.marketing * 3) + S.co.subs.length, 4, 16);
  while (customers.length < want) customers.push(newCustomer());
  while (customers.length > want) customers.pop();

  for (const p of customers) {
    const sp = p.sp * (S.speed ? 0.6 + S.speed * 0.35 : 0.4);
    if (p.wait > 0) { p.wait -= 1; drawPerson(p.x, p.y, p.c, p.s, 0); continue; }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 2) {
      if (p.phase === 'shelf')      { p.wait = rint(30, 80); p.phase = 'counter'; p.tx = COUNTER.x + 10; p.ty = COUNTER.y + 42; }
      else if (p.phase === 'counter') {
        p.wait = rint(20, 45); p.phase = 'leave'; p.tx = DOOR.x + rnd(-12, 12); p.ty = STORE_H + 24;
        const amt = Math.max(1000, dailyRetail(S) / Math.max(6, want * 2.2));
        pops.push({ x: p.x, y: p.y - 10, t: 46, txt: '+' + won(amt), c: '#2FA37A' });
      }
      else { Object.assign(p, newCustomer()); continue; }
    } else { p.x += dx / d * sp; p.y += dy / d * sp; }
    drawPerson(p.x, p.y, p.c, p.s, Math.floor(frame / 8 + p.x) % 2);
  }
}

export { COUNTER, DOOR, SHELVES, drawStore, newCustomer, spawnCustomers, updateCustomers };
