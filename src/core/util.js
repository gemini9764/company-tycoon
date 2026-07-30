/* ══════════════════════════════════════════════════════════════
   컴퍼니 타이쿤 — 프로토타입
   구조: core(상수/상태/저장) → systems(로직) → render(캔버스) → ui(패널) → loop
   서버 없음. 저장은 window.storage → localStorage → 메모리 순 폴백.
   ══════════════════════════════════════════════════════════════ */

/* ── 유틸 ────────────────────────────────────────────────── */
const rnd  = (a, b) => a + Math.random() * (b - a);

const rint = (a, b) => Math.floor(rnd(a, b + 1));

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const chance = p => Math.random() < p;

function won(n) {
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e12) return s + (n / 1e12).toFixed(2) + '조';
  if (n >= 1e8)  return s + (n / 1e8).toFixed(n >= 1e10 ? 0 : 1) + '억';
  if (n >= 1e4)  return s + Math.round(n / 1e4).toLocaleString() + '만';
  return s + Math.round(n).toLocaleString();
}

const pct = n => Math.round(n) + '%';

/* ══════════════════════════════════════════════════════════════
   UI — DOM 패널. 상태를 읽기만 하고, 조작은 systems 함수를 호출한다.
   ══════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));

export { $, chance, clamp, esc, pct, pick, rint, rnd, won };
