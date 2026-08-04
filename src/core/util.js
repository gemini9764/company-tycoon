import { rand, viewRand } from './rng.js';

/* ══════════════════════════════════════════════════════════════
   컴퍼니 타이쿤 — 프로토타입
   구조: core(상수/상태/저장) → systems(로직) → render(캔버스) → ui(패널) → loop
   서버 없음. 저장은 window.storage → localStorage → 메모리 순 폴백.
   ══════════════════════════════════════════════════════════════ */

/* ── 유틸 ──────────────────────────────────────────────────
   난수는 전부 core/rng.js 를 지난다. Math.random 을 직접 부르면 그 값만
   시드 밖으로 새어 나가 같은 시드에서 다른 판이 나온다.

   `rnd/rint/pick/chance` = 게임 스트림 (세이브에 상태가 남는다)
   `vrnd/vrint/vpick/vchance` = 연출 스트림 (차량·손님·머리 모양 등) */
const rnd  = (a, b) => a + rand() * (b - a);

const rint = (a, b) => Math.floor(rnd(a, b + 1));

const pick = arr => arr[Math.floor(rand() * arr.length)];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const chance = p => rand() < p;

const vrnd  = (a, b) => a + viewRand() * (b - a);

const vrint = (a, b) => Math.floor(vrnd(a, b + 1));

const vpick = arr => arr[Math.floor(viewRand() * arr.length)];

const vchance = p => viewRand() < p;

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

export { $, chance, clamp, esc, pct, pick, rint, rnd, won, vchance, vpick, vrint, vrnd };
