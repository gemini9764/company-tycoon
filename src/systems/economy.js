import { BAL } from '../core/balance.js';
import { SECTORS } from '../core/data.js';
import { sumStat } from '../core/derive.js';
import { isHolding, perksOf, sectorBonusOf, subMgrLoad, subYieldMul, tagMarketing, tagSynergy } from '../core/tags.js';
import { $, clamp, rnd, won } from '../core/util.js';
import { checkBankrupt, seizeSub } from './bank.js';
import { rollSubVol } from './subs.js';
import { pushInbox } from '../ui/toast.js';

/* ── 매장 시설 ────────────────────────────────────────────
   레벨을 올리면 매출·손님·재고 유지 기간·관리 인력에 영구 보너스가 붙는다.
   타일 배치는 건드리지 않는다 — 손님 경로가 그 격자를 쓰기 때문. */
const FACIL = {
  shelf:   { n: '진열대 증설', max: 3, tier: 0, d: '매출 +7% / 단계' },
  counter: { n: '계산대 확장', max: 3, tier: 1, d: '손님 +2명 · 매출 +4% / 단계' },
  cold:    { n: '냉장 설비',   max: 3, tier: 1, d: '재고 유지 +4일 / 단계' },
  office:  { n: '사무실 확장', max: 3, tier: 2, d: '관리 인력 +1명분 / 단계' },
};

const facLv = (s, k) => (s.co.facil && s.co.facil[k]) || 0;

/** 다음 단계 비용. 회사 규모를 따라가므로 후반에도 의미가 남는다. */
function facilCost(s, k) {
  const lv = facLv(s, k);
  const cut = 1 + perksOf(s).facilCost;                     // tech 계열사가 깎는다
  return Math.round(Math.max(2e7, retailPotential(s) * 9) * Math.pow(2.2, lv) * cut);
}

function facilLocked(s, k) { return s.co.tier < FACIL[k].tier; }

/* ── 경영: 일 매출/비용 ──────────────────────────────────── */
/** 재고를 무시한 매출 잠재력. 발주 단가의 기준이라 재고와 순환하지 않게 분리한다. */
function retailPotential(s) {
  const base = BAL.retailBase * BAL.tierRetailMul[s.co.tier];
  const salesBuf = 1 + sumStat(s.staff, 'sales') * 0.004
                 + s.staff.filter(e => e.trait.id === 'star').length * 0.12;
  const variety = 1 + s.co.subs.length * 0.06;
  const fac = 1 + facLv(s, 'shelf') * 0.07 + facLv(s, 'counter') * 0.04;
  const pk  = 1 + perksOf(s).retailMul;                     // daily 계열사
  const brd = 1 + tagMarketing(s) * 0.1;                    // 브랜드 태그
  return base * s.co.marketing * salesBuf * variety * fac * pk * brd;
}

/** 재고가 매출에 곱해지는 배수. 바닥나도 invFloor 까지만 떨어진다. */
function invFactor(s) {
  const r = clamp((s.co.inv ?? 100) / 100, 0, 1);
  return BAL.invFloor + (1 - BAL.invFloor) * r;
}

function dailyRetail(s) { return retailPotential(s) * invFactor(s); }

/** 만재에서 바닥까지 걸리는 일수 */
function invLife(s) { return (BAL.invDays + facLv(s, 'cold') * 4) * (1 + perksOf(s).invLife); }

/** 재고 pct 만큼 채우는 값. 절반 이상 한 번에 채우면 할인. */
function invCost(s, pct) {
  const raw = retailPotential(s) * BAL.invUnit * pct * (1 + perksOf(s).invCost);
  return Math.round(raw * (pct >= 50 ? 1 - BAL.invBulkOff : 1));
}

/** 발주 실행. 살 수 있는 만큼만 채우고 실제 채운 양을 돌려준다. */
function orderInv(s, pct, autoUp) {
  const room = Math.max(0, 100 - (s.co.inv ?? 100));
  let want = Math.min(pct, room);
  if (want <= 0) return 0;
  const mul = autoUp ? 1 + BAL.invAutoUp : 1;
  let cost = Math.round(invCost(s, want) * mul);
  if (cost > s.co.cash) {                       // 살 수 있는 만큼으로 줄인다
    want = Math.floor(want * (s.co.cash / cost));
    if (want <= 0) return 0;
    cost = Math.round(invCost(s, want) * mul);
  }
  s.co.cash -= cost;
  s.co.inv = clamp((s.co.inv ?? 100) + want, 0, 100);
  return want;
}

/* 하루치 재고 소모. 자동 발주면 소모분을 바로 되채운다(단가 할증).
   이름을 inv 로 둔 이유는 systems/stock.js(주식)와 헷갈리지 않게 하려는 것. */
function tickInv(s) {
  const before = s.co.inv ?? 100;
  s.co.inv = clamp(before - 100 / invLife(s), 0, 100);
  if (s.co.autoOrder) orderInv(s, 100 - s.co.inv, true);
  else if (before >= BAL.invWarnAt && s.co.inv < BAL.invWarnAt) {
    pushInbox(s, '재고 부족', `매장 재고가 ${Math.round(s.co.inv)}% 입니다. 발주하지 않으면 매출이 최대 ${Math.round((1 - BAL.invFloor) * 100)}% 까지 빠집니다.`, 'bad');
  }
}

/* 통합 진척도 — 인수 직후엔 시너지가 안 나오고, pmiDays에 걸쳐 100%까지 올라온다.
   관리비는 첫날부터 전액 나가므로 차입 인수는 초반 몇 달간 현금이 마른다. */
function pmi(s, c) {
  const days = BAL.pmiDays * (1 - perksOf(s).pmiFast);      // IT 계열사가 단축
  return clamp((s.day - (c.day ?? 0)) / Math.max(8, days), BAL.pmiFloor, 1);
}

/* 그룹 운영 효율 — 계열사 수익 전체에 곱해지는 배수.
   업종을 겹쳐 인수할수록 오르고, 관리 인력이 모자라거나 통합이 밀리면 떨어진다.
   후반부에도 경영 모드의 결정이 그룹 수익의 최대 변수로 남게 하는 장치. */
function managersNeeded(s) {
  const load = s.co.subs.reduce((a, c) => a + subMgrLoad(c), 0);   // 강성 노조는 2인분
  return Math.ceil(load / BAL.subsPerManager * (isHolding(s) ? 0.75 : 1));   // 지주회사 체제 -25%
}

function managersHave(s)   { return s.staff.filter(e => !e.onTeam).length + facLv(s, 'office') + perksOf(s).managers; }

function synergyParts(s) {
  const bySec = {};
  s.co.subs.forEach(c => bySec[c.sector] = (bySec[c.sector] || 0) + 1);
  const focus  = Object.values(bySec).reduce((a, n) => a + Math.max(0, n - 1) * 0.030, 0);
  const short  = -Math.max(0, managersNeeded(s) - managersHave(s)) * 0.09;
  const integ  = -s.co.subs.filter(c => pmi(s, c) < 1).length * 0.05;
  const audit  = s.co.auditBuff || 0;
  const tag    = tagSynergy(s);                              // 오너 일가 등
  return { focus, short, integ, audit, tag,
           target: clamp(1 + focus + short + integ + audit + tag, BAL.synMin, BAL.synMax) };
}

function tickSynergy(s) {
  const t = synergyParts(s).target;
  s.co.synergy += (t - s.co.synergy) * BAL.synLerp;
  s.co.auditBuff = (s.co.auditBuff || 0) * BAL.auditDecay;
}

function dailySubIncome(s) {
  const syn = s.co.synergy ?? 1;
  const sec = sectorBonusOf(s);                              // 특허 보유 → 같은 업종 전체 +10%
  const pk  = 1 + perksOf(s).subIncome;                      // 제약 계열사
  const sum = s.co.subs.reduce((a, c) => {
    if (c.restruct) return a;                                // 재편 중에는 수익이 없다
    return a + c.cap * BAL.subYield * (1 + SECTORS[c.sector].margin) * pmi(s, c) * subYieldMul(c, sec);
  }, 0);
  return sum * syn * pk;
}

function dailyUpkeep(s) {
  return s.co.subs.reduce((a, c) => a + c.cap * BAL.subYield * (pmi(s, c) < 1 ? 0.46 : 0.36), 0) + dailyRetail(s) * BAL.retailUpkeep;
}

function tickEconomy(s) {
  tickInv(s);
  const rev  = dailyRetail(s) * rnd(0.88, 1.14) + dailySubIncome(s);
  const cost = dailyUpkeep(s);
  s.co.revToday = rev; s.co.costToday = cost;
  s.co.cash += rev - cost;
  s.co.rev30.push(rev - cost);
  if (s.co.rev30.length > 30) s.co.rev30.shift();
  const pk = perksOf(s);
  const decay = 1 - (1 - BAL.marketingDecay) * (1 - Math.min(0.8, pk.mktKeep));   // 의류
  s.co.marketing = Math.min(BAL.marketingCap, Math.max(1, s.co.marketing * decay + pk.mktGain)); // 미디어
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
  rollSubVol(s);   // 해외 법인 수익 변동 배수를 새로 뽑는다

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

export { FACIL, facLv, facilCost, facilLocked, invCost, orderInv, retailPotential, invFactor, invLife, tickInv, dailyRetail, dailySubIncome, dailyUpkeep, managersHave, managersNeeded, pmi, synergyParts, tickEconomy, tickMonth, tickSynergy };
