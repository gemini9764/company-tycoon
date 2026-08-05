import { BAL } from '../core/balance.js';
import { SECTORS } from '../core/data.js';
import { bumpPerks, curableTag, hasTag, SUB_TAGS, tagsOf } from '../core/tags.js';
import { chance, rint, rnd, won } from '../core/util.js';
import { recalcCap } from './company.js';
import { pmi } from './economy.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ══════════════════════════════════════════════════════════════
   계열사 개별 운영 — 매각 / 투자 / 재편

   M&A 게임인데 '파는' 행위가 없었다. 자금원이 매장 매출·계열사 수익·대출
   셋뿐이고 앞의 둘은 시간, 뒤의 하나는 리스크다 — **판단으로 얻는 자금원**이
   없었다. 매각이 그 자리를 채운다.

   매각가에 15% 손실을 둔 이유는 사고팔기 반복이 이득이 되면 안 되기 때문이다.
   `rot`(부실) 매물을 투자로 정상화해 되팔 때만 흑자가 나도록 잡았다.
   이 계수는 sim 으로 반드시 검증할 것 (기획서 §12-1).
   ══════════════════════════════════════════════════════════════ */

/* ── 매각 ────────────────────────────────────────────────── */

/** 담보로 잡혀 있으면 못 판다. 은행 쪽은 계열사를 이름으로 물고 있다. */
function subPledged(s, c) {
  return s.bank.loans.some(l => l.collateral === c.name);
}

/**
 * 매각 대금. 통합이 안 끝난 계열사는 제값을 못 받는다 —
 * 인수 직후 되팔아 차익을 노리는 회전을 막는 장치.
 */
function subSellValue(s, c) {
  let v = c.cap * BAL.subSellRate;
  if (hasTag(c, 'owner')) v *= SUB_TAGS.owner.sell;
  if (pmi(s, c) < 1) v *= BAL.subSellPmiCut;
  return Math.round(v);
}

function canSellSub(s, c) {
  if (subPledged(s, c)) return '담보로 잡혀 있어 매각할 수 없습니다';
  if (c.restruct) return '사업 재편이 진행 중입니다';
  return null;
}

function sellSub(s, c) {
  const why = canSellSub(s, c);
  if (why) return toast(why, 'bad');

  const v = subSellValue(s, c);
  s.co.cash += v;
  s.co.subs = s.co.subs.filter(x => x.id !== c.id);

  // 매물로 되돌린다. 다시 인수할 수 있어야 시장이 마르지 않는다.
  const m = s.market.find(x => x.id === c.id);
  if (m) { m.owned = false; m.cap = c.cap; m.tags = tagsOf(c).slice(); }

  bumpPerks(); recalcCap(s);
  news(`${s.co.name}, ${c.name} 매각 (${won(v)})`);
  pushInbox(s, '계열사 매각', `${c.name}을(를) ${won(v)}에 매각했습니다. 시장에 다시 매물로 나옵니다.`, 'info');
  toast(`${c.name} 매각 — ${won(v)}`, 'good');
}

/* ── 투자 ────────────────────────────────────────────────── */

function investCost(s, c) { return Math.round(c.cap * BAL.subInvestRate); }

/**
 * 시총을 올리고 고칠 수 있는 태그(부실·노후) 하나를 없앤다.
 * 태그가 없어도 시총은 오르므로 후반 자금 소진처로도 쓰인다.
 */
function investSub(s, c) {
  const cost = investCost(s, c);
  if (s.co.cash < cost) return toast('자금이 부족합니다', 'bad');
  if (c.restruct) return toast('사업 재편이 진행 중입니다', 'bad');

  s.co.cash -= cost;
  c.cap = Math.round(c.cap * (1 + BAL.subInvestGain));

  const cured = curableTag(c);
  if (cured) {
    c.tags = tagsOf(c).filter(k => k !== cured);
    toast(`${c.name} — ${SUB_TAGS[cured].n} 해소`, 'good');
    news(`${c.name} 정상화 — ${SUB_TAGS[cured].n} 해소`);
  } else {
    toast(`${c.name} 시가총액 +${Math.round(BAL.subInvestGain * 100)}%`, 'good');
  }
  bumpPerks(); recalcCap(s);
}

/* ── 사업 재편 (업종 전환) ───────────────────────────────── */

function restructCost(s, c) { return Math.round(c.cap * BAL.subRestructRate); }

/**
 * 기간 중에는 수익이 0이다. PMI(40일)보다 길게 잡아
 * 업종 집중을 돈으로 즉시 사는 길을 막는다.
 */
function restructSub(s, c, sector) {
  if (sector === c.sector) return toast('같은 업종입니다', 'bad');
  const cost = restructCost(s, c);
  if (s.co.cash < cost) return toast('자금이 부족합니다', 'bad');

  s.co.cash -= cost;
  c.restruct = { to: sector, until: s.day + BAL.subRestructDays };
  news(`${c.name}, ${SECTORS[sector].name} 업종으로 사업 재편 착수`);
  pushInbox(s, '사업 재편', `${c.name}이(가) ${SECTORS[sector].name} 업종으로 전환합니다. ${BAL.subRestructDays}일간 이 계열사의 수익은 발생하지 않습니다.`, 'info');
}

/* ── 매일 처리 ───────────────────────────────────────────
   재편 완료, 우발채무 발동, 해외 법인 변동폭 갱신.
   loop.js 의 tickDay 에서 tickEconomy 앞에 부른다. */
function tickSubs(s) {
  for (const c of s.co.subs) {
    // 재편 완료
    if (c.restruct && s.day >= c.restruct.until) {
      const to = c.restruct.to;
      c.sector = to; c.restruct = null;
      bumpPerks(); recalcCap(s);
      news(`${c.name} 사업 재편 완료 — ${SECTORS[to].name}`);
      pushInbox(s, '재편 완료', `${c.name}이(가) ${SECTORS[to].name} 업종으로 전환을 마쳤습니다.`, 'good');
    }
    // 우발채무 — 인수 시점에 잡아 둔 날짜에 터진다
    if (c.debtDay && s.day >= c.debtDay) {
      c.debtDay = 0;
      fireHiddenDebt(s, c);
    }
  }
}

/**
 * 숨은 빚. 비용 상한을 **보유 자금 기준**으로 잡는다 —
 * 시총 비례로 두면 후반에 즉사한다 (HANDOFF §8 '세무조사로 즉사'와 같은 함정).
 */
function fireHiddenDebt(s, c) {
  const raw = c.cap * BAL.hiddenDebtRate;
  const hit = Math.round(Math.min(raw, Math.max(0, s.co.cash) * 0.45));
  s.co.cash -= hit;
  c.tags = tagsOf(c).filter(k => k !== 'debt');
  news(`${c.name}에서 누락된 채무 발견`);
  pushInbox(s, '우발채무 발생',
    `${c.name}의 장부에 없던 채무 ${won(hit)}이(가) 확인됐습니다. 인수 전 <b>실사</b>를 했다면 미리 알 수 있었습니다.`, 'bad');
  toast(`우발채무 -${won(hit)}`, 'bad');
}

/* ── 인수 직후 처리 ──────────────────────────────────────
   completeAcq 에서 계열사를 push 한 **직후** 부른다. */
function onAcquired(s, sub, tgt) {
  // 우발채무: 확률로 발동 날짜를 잡아 둔다. 실사로 미리 봤어도 효과는 그대로다
  if (hasTag(sub, 'debt') && chance(SUB_TAGS.debt.risk)) {
    sub.debtDay = s.day + rint(5, 30);
  }
  // 해외 법인: 월별 변동 배수 초기화
  if (hasTag(sub, 'global')) sub.vol = rnd(0.7, 1.4);

  // 자회사 보유: 소형 계열사가 딸려 온다
  if (hasTag(sub, 'child')) {
    const kid = {
      id: sub.id + '-k', name: sub.name.slice(0, 3) + '홀딩스',
      sector: sub.sector, cap: Math.round(sub.cap * SUB_TAGS.child.spawn),
      diff: Math.max(0, sub.diff - 1), day: s.day, tags: [],
    };
    s.co.subs.push(kid);
    news(`${sub.name} 인수로 ${kid.name}이(가) 함께 편입`);
    toast(`${kid.name} 자동 편입 — ${won(kid.cap)}`, 'good');
  }
  bumpPerks();
}

/** 월 정산에서 해외 법인 변동 배수를 새로 뽑는다 */
function rollSubVol(s) {
  s.co.subs.forEach(c => { if (hasTag(c, 'global')) c.vol = rnd(0.7, 1.4); });
}

export { canSellSub, sellSub, subPledged, subSellValue };
export { investCost, investSub, restructCost, restructSub };
export { fireHiddenDebt, onAcquired, rollSubVol, tickSubs };
