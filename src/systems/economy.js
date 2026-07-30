import { BAL } from '../core/balance.js';
import { SECTORS } from '../core/data.js';
import { sumStat } from '../core/derive.js';
import { $, clamp, rnd, won } from '../core/util.js';
import { checkBankrupt, seizeSub } from './bank.js';
import { pushInbox } from '../ui/toast.js';

/* ── 경영: 일 매출/비용 ──────────────────────────────────── */
function dailyRetail(s) {
  const base = BAL.retailBase * BAL.tierRetailMul[s.co.tier];
  const salesBuf = 1 + sumStat(s.staff, 'sales') * 0.004
                 + s.staff.filter(e => e.trait.id === 'star').length * 0.12;
  const variety = 1 + s.co.subs.length * 0.06;
  return base * s.co.marketing * salesBuf * variety;
}

/* 통합 진척도 — 인수 직후엔 시너지가 안 나오고, pmiDays에 걸쳐 100%까지 올라온다.
   관리비는 첫날부터 전액 나가므로 차입 인수는 초반 몇 달간 현금이 마른다. */
function pmi(s, c) {
  return clamp((s.day - (c.day ?? 0)) / BAL.pmiDays, BAL.pmiFloor, 1);
}

/* 그룹 운영 효율 — 계열사 수익 전체에 곱해지는 배수.
   업종을 겹쳐 인수할수록 오르고, 관리 인력이 모자라거나 통합이 밀리면 떨어진다.
   후반부에도 경영 모드의 결정이 그룹 수익의 최대 변수로 남게 하는 장치. */
function managersNeeded(s) { return Math.ceil(s.co.subs.length / BAL.subsPerManager); }

function managersHave(s)   { return s.staff.filter(e => !e.onTeam).length; }

function synergyParts(s) {
  const bySec = {};
  s.co.subs.forEach(c => bySec[c.sector] = (bySec[c.sector] || 0) + 1);
  const focus  = Object.values(bySec).reduce((a, n) => a + Math.max(0, n - 1) * 0.030, 0);
  const short  = -Math.max(0, managersNeeded(s) - managersHave(s)) * 0.09;
  const integ  = -s.co.subs.filter(c => pmi(s, c) < 1).length * 0.05;
  const audit  = s.co.auditBuff || 0;
  return { focus, short, integ, audit,
           target: clamp(1 + focus + short + integ + audit, BAL.synMin, BAL.synMax) };
}

function tickSynergy(s) {
  const t = synergyParts(s).target;
  s.co.synergy += (t - s.co.synergy) * BAL.synLerp;
  s.co.auditBuff = (s.co.auditBuff || 0) * BAL.auditDecay;
}

function dailySubIncome(s) {
  const syn = s.co.synergy ?? 1;
  return s.co.subs.reduce((a, c) => a + c.cap * BAL.subYield * (1 + SECTORS[c.sector].margin) * pmi(s, c), 0) * syn;
}

function dailyUpkeep(s) {
  return s.co.subs.reduce((a, c) => a + c.cap * BAL.subYield * (pmi(s, c) < 1 ? 0.46 : 0.36), 0) + dailyRetail(s) * 0.42;
}

function tickEconomy(s) {
  const rev  = dailyRetail(s) * rnd(0.88, 1.14) + dailySubIncome(s);
  const cost = dailyUpkeep(s);
  s.co.revToday = rev; s.co.costToday = cost;
  s.co.cash += rev - cost;
  s.co.rev30.push(rev - cost);
  if (s.co.rev30.length > 30) s.co.rev30.shift();
  s.co.marketing = Math.max(1, s.co.marketing * BAL.marketingDecay);
  tickSynergy(s);
}

/* ── 월 정산 ─────────────────────────────────────────────── */
function tickMonth(s) {
  const lines = [];
  const pay = s.staff.reduce((a, e) => a + e.salary, 0);
  if (pay) { s.co.cash -= pay; lines.push(`급여 -${won(pay)}`); }

  for (const l of s.bank.loans.slice()) {
    if (s.co.cash >= l.due) {
      s.co.cash -= l.due; l.left = Math.max(0, l.left - (l.due - l.left * l.rate / 1200));
      l.months--;
      if (l.months <= 0 || l.left < 1) {
        s.bank.loans.splice(s.bank.loans.indexOf(l), 1);
        lines.push(`${l.kind === 'acq' ? '인수금융' : '운영자금'} 완제`);
      }
    } else if (l.collateral) {
      // 인수금융 상환 실패 → 담보로 잡힌 계열사 압류
      seizeSub(s, l);
      s.bank.loans.splice(s.bank.loans.indexOf(l), 1);
      lines.push(`<b class="c-blood">${l.collateral} 압류</b>`);
    } else {
      s.bank.overdue++;
      l.left *= 1.08;
      lines.push(`<b class="c-blood">연체 발생 (누적 ${s.bank.overdue}회)</b>`);
      pushInbox(s, '연체', `${won(l.due)} 상환 실패. 연체 이자가 붙고 신용 등급이 하락합니다. 3회 누적 시 파산합니다.`, 'bad');
    }
  }
  if (s.bank.insured) {
    const fee = s.co.cap * BAL.insuranceRate;
    s.co.cash -= fee; lines.push(`파산 보험료 -${won(fee)}`);
  }
  s.co.donate = Math.max(0, s.co.donate - 0.4); // 기부 효과는 서서히 희석

  // 주가 실적 반영
  s.market.forEach(c => {
    if (!c.listed) return;
    const drift = c.curse > 0 ? rnd(-0.14, -0.02) : rnd(-0.04, 0.06);
    c.price = Math.max(10, Math.round(c.price * (1 + drift)));
    c.curse = Math.max(0, c.curse - 1);
    c.hist.push(c.price); if (c.hist.length > 24) c.hist.shift();
  });

  if (lines.length) pushInbox(s, `${Math.floor(s.day / 30)}개월차 정산`, lines.join('<br>'), 'info');
  checkBankrupt(s);
}

export { dailyRetail, dailySubIncome, dailyUpkeep, managersHave, managersNeeded, pmi, synergyParts, tickEconomy, tickMonth, tickSynergy };
