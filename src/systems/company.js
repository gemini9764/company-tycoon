import { BAL } from '../core/balance.js';
import { CREDITS, TIERS } from '../core/data.js';
import { debtTotal, sumStat, teamOf } from '../core/derive.js';
import { $, clamp } from '../core/util.js';
import { dailyRetail } from './economy.js';
import { checkEnding } from './ending.js';
import { openModal } from '../ui/modal.js';
import { news } from '../ui/toast.js';

function creditScore(s) {
  const assets = Math.max(1, s.co.cap);
  const ratio  = debtTotal(s) / assets;
  let v = 52 + s.co.tier * 4.5
        - ratio * 45
        - s.bank.overdue * 9
        - s.co.mistrust * 0.28
        - s.co.probe * 0.18
        + s.co.donate
        + sumStat(s.staff, 'fin') * 0.06;
  return clamp(v, 0, 100);
}

const creditIdx  = s => clamp(Math.floor(creditScore(s) / 10), 0, 9);

const creditName = s => CREDITS[creditIdx(s)];

function loanRate(s, kind) {
  return BAL.baseRate + s.bank.rateDelta_ + (9 - creditIdx(s)) * 0.85 + (kind === 'acq' ? 3.2 : 0)
       - Math.min(1.4, sumStat(s.staff, 'fin') * 0.012);
}

function recalcCap(s) {
  // 계열사 자산 + 본업 수익의 자본화(8배) + 현금 - 부채. 계열사 수익은 자산에 이미 반영돼
  // 있으므로 중복 계산하지 않는다.
  const subCap = s.co.subs.reduce((a, c) => a + c.cap, 0);
  s.co.cap = Math.max(1e6,
    subCap + dailyRetail(s) * 365 * 8 + s.co.cash * 0.5 - debtTotal(s) * 0.6);
  // 순위: 시총 로그 위치를 볼록 곡선으로 매핑. 초반에도 순위가 조금씩 움직여
  // 성장 실감을 주되, 상위권으로 갈수록 한 계단이 무거워진다.
  const lo = Math.log10(BAL.rankFloor), hi = Math.log10(BAL.rankTop);
  const frac = clamp((hi - Math.log10(s.co.cap)) / (hi - lo), 0, 1);
  s.co.rank = clamp(Math.round(1 + 4999 * Math.pow(frac, BAL.rankCurve)), 1, 5000);
}

/* ── 등급 ────────────────────────────────────────────────── */
function checkTier(s) {
  const cur = TIERS[s.co.tier];
  if (s.co.tier < TIERS.length - 1 && cur.ok(s)) {
    s.co.tier++;
    const nt = TIERS[s.co.tier];
    if (nt.name === '스타트업') s.shaman.unlocked = true;
    openModal({
      title: '등급 상승',
      body: `<div style="text-align:center;padding:8px 0">
        <div style="font-size:11px" class="c-dim">${cur.name}</div>
        <div style="font-size:26px;margin:10px 0" class="c-gold">▼</div>
        <div style="font-size:22px">${nt.name}</div>
        <div style="margin-top:14px;font-size:11px">다음 목표 — ${nt.goal}</div>
        ${nt.unlock ? `<div style="margin-top:6px;font-size:11px" class="c-sky">${nt.unlock} 해금</div>` : ''}
        <div style="margin-top:10px;font-size:10px" class="c-dim">인수 가능한 기업 규모 상한이 올라갑니다.</div>
      </div>`,
      actions: [{ label: '계속', cls: 'gold' }],
    });
    news(`${s.co.name}, ${nt.name}(으)로 도약`);
    if (s.co.tier === TIERS.length - 1) checkEnding(s);
  }
}

const capCeiling = s => [3e8, 2e9, 2e10, 2e11, 1.5e12, 6e12, Infinity][s.co.tier];

/* ── M&A ─────────────────────────────────────────────────── */
function teamPower(s) {
  const t = teamOf(s);
  if (!t.length) return 0;
  let p = sumStat(t, 'nego');
  p *= 1 + t.filter(e => e.trait.id === 'shark').length * 0.15;
  p *= 1 + (t.length - 1) * 0.10;   // 인원 시너지
  return p;
}

export { capCeiling, checkTier, creditIdx, creditName, creditScore, loanRate, recalcCap, teamPower };
