import { BAL } from '../core/balance.js';
import { RUMOR_GRADES } from '../core/data.js';
import { sumStat } from '../core/derive.js';
import { rand } from '../core/rng.js';
import { $, chance, pick } from '../core/util.js';
import { capCeiling } from './company.js';
import { toast } from '../ui/toast.js';

/* ── 찌라시 ──────────────────────────────────────────────── */
function tickRumor(s) {
  const intel = sumStat(s.staff, 'intel');
  const ear = 1 + s.staff.filter(e => e.trait.id === 'ear').length * 0.6;
  if (!chance(intel * BAL.rumorChanceBase * ear)) return;
  const total = RUMOR_GRADES.reduce((a, g) => a + g.w, 0);
  let r = rand() * total, g = RUMOR_GRADES[0];
  for (const x of RUMOR_GRADES) { r -= x.w; if (r <= 0) { g = x; break; } }
  const cands = s.market.filter(c => !c.owned && c.cap <= capCeiling(s) * 2);
  if (!cands.length) return;
  const t = pick(cands);
  s.rumors.unshift({
    id: 'r' + Math.random().toString(36).slice(2, 7),
    grade: g.g, val: g.val, target: t.id, tname: t.name, day: s.day, used: false,
    text: pick([
      `${t.name} 대주주가 지분 정리를 서두른다는 얘기가 돈다.`,
      `${t.name} 주력 사업부 실적이 장부보다 나쁘다는 소문.`,
      `${t.name} 경영진 내분이 심각하다는 전언.`,
      `${t.name}이(가) 다른 곳과 매각 협상 중 결렬됐다는 정보.`,
    ]),
  });
  if (s.rumors.length > 12) s.rumors.pop();
  toast(`${g.g}급 찌라시 입수 — ${t.name}`, 'good');
}

function useRumor(s, r) {
  r.used = true;
  const t = s.market.find(c => c.id === r.target);
  if (r.val >= 0.16 && t.diff > 0) t.diff--;
  if (s.nego?.id === r.target) s.nego.prem = Math.max(0.02, s.nego.prem - r.val);
  toast(`${r.tname} 인수가 프리미엄 -${Math.round(r.val * 100)}%p 적용`, 'good');
}

export { tickRumor, useRumor };
