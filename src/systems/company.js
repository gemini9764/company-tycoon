import { BAL } from '../core/balance.js';
import { CREDITS, TIERS } from '../core/data.js';
import { debtTotal, grossAssets, netWorth, sumStat, teamOf } from '../core/derive.js';
import { makeStaff } from '../core/state.js';
import { facLv } from './economy.js';
import { $, clamp } from '../core/util.js';
import { dailyRetail } from './economy.js';
import { checkEnding } from './ending.js';
import { openModal } from '../ui/modal.js';
import { news, pushInbox, toast } from '../ui/toast.js';

function creditScore(s) {
  const assets = Math.max(1, grossAssets(s));   // 시총이 아니라 실물 자산으로 본다
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
  return BAL.baseRate + s.bank.rateDelta_ + (9 - creditIdx(s)) * 0.85 + (kind === 'acq' ? BAL.acqRatePremium : 0)
       - Math.min(1.4, sumStat(s.staff, 'fin') * 0.012);
}

/**
 * 시가총액과 순위.
 *
 *   보유 자금 = 현금
 *   순자산    = 보유 자금 + 계열사 가치 − 부채   ← **순위는 이 값으로 매긴다**
 *   시가총액  = 순자산 + 본업 가치(매장 수익 8배 자본화)
 *
 * 세 값이 포함 관계라 나란히 놓아도 헷갈리지 않는다. 예전에는 시총이 현금을
 * 절반만, 부채를 60% 만 세는 별도 식이라 순자산과 관계가 설명되지 않았다.
 *
 * **순위를 시총이 아니라 순자산에서 뽑는다.** 본업 수익의 8배 자본화가 순위에
 * 섞이면 "회사를 샀는데 순위가 그만큼 안 오른다"가 되어 인수의 보상이 흐려진다.
 */
function recalcCap(s) {
  s.co.cap = Math.max(1e6, netWorth(s) + dailyRetail(s) * 365 * 8);
  // 순위: 순자산의 로그 위치를 볼록 곡선으로 매핑. 초반에도 조금씩 움직여
  // 성장 실감을 주되, 상위권으로 갈수록 한 계단이 무거워진다.
  const nw = Math.max(1e6, netWorth(s));
  const lo = Math.log10(BAL.rankFloor), hi = Math.log10(BAL.rankTop);
  const frac = clamp((hi - Math.log10(nw)) / (hi - lo), 0, 1);
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
        <div style="font-size:12px" class="c-dim">${cur.name}</div>
        <div style="font-size:24px;margin:10px 0" class="c-gold">▼</div>
        <div style="font-size:24px">${nt.name}</div>
        <div style="margin-top:14px;font-size:12px">다음 목표 — ${nt.goal}</div>
        ${nt.unlock ? `<div style="margin-top:6px;font-size:12px" class="c-sky">${nt.unlock} 해금</div>` : ''}
        <div style="margin-top:10px;font-size:10px;font-family:var(--f-sm)" class="c-dim">인수 가능한 기업 규모 상한이 올라갑니다.</div>
      </div>`,
      actions: [{ label: '계속', cls: 'gold' }],
    });
    news(`${s.co.name}, ${nt.name}(으)로 도약`);
    if (s.co.tier === TIERS.length - 1) checkEnding(s);
  }
}

const capCeiling = s => [3e8, 2e9, 2e10, 2e11, 1.5e12, 6e12, Infinity][s.co.tier];

/* ── M&A ─────────────────────────────────────────────────── */
function teamPower(s, slot) {
  const t = teamOf(s, slot);
  if (!t.length) return 0;
  let p = sumStat(t, 'nego');
  p *= 1 + t.filter(e => e.trait.id === 'shark').length * 0.15;
  p *= 1 + (t.length - 1) * 0.10;   // 인원 시너지
  return p;
}

/* ══════════════════════════════════════════════════════════════
   직원 육성

   레벨은 sumStat 이 `1 + (lv-1) * 0.15` 로 읽는다. 즉 레벨 하나가 그 사람의
   전 능력치를 실효 15% 올린다 — 협상력·정보력·영업력이 한꺼번에 오른다.
   그래서 경험치를 후하게 주면 후반 협상이 통째로 쉬워진다. 반드시 sim 으로
   완주일을 보고 조정할 것.
   ══════════════════════════════════════════════════════════════ */

/** 다음 레벨까지 필요한 경험치 */
const expNeed = e => Math.round(BAL.expBase * Math.pow(BAL.expGrow, e.lv - 1));

/**
 * 경험치를 넣고, 넘치면 레벨을 올린다. 교육비를 내는 쪽도 이 함수를 쓴다 —
 * 두 경로가 갈리면 "돈으로 올린 레벨" 과 "일해서 오른 레벨" 이 서로 다른
 * 규칙을 갖게 되고, 그때부터 어느 쪽이 이득인지 아무도 모른다.
 * @param {boolean} paid 교육비 경로인가 (상한을 받지 않는다)
 */
function gainExp(s, e, amt, paid = false) {
  e.exp = (e.exp || 0) + amt;
  let up = 0;
  while (e.exp >= expNeed(e) && (paid || e.lv < BAL.expFreeCap)) {
    e.exp -= expNeed(e); e.lv++; up++;
    e.salary = Math.round(e.salary * 1.12);
  }
  if (!paid && e.lv >= BAL.expFreeCap) e.exp = Math.min(e.exp, expNeed(e));   // 상한에서 고인다
  return up;
}

/**
 * 하루치 경험치. **실제로 한 일에서만 나온다.**
 * 협상단에 편성돼 있어도 협상이 안 돌면 관리 인력과 같은 취급이다 —
 * 편성만 해 두고 노는 것이 이득이 되면 안 된다.
 */
function tickStaff(s) {
  const managing = s.co.subs.length > 0;
  /* **자기 슬롯이 협상 중일 때만** 협상 경험치다. 2팀이 되면서 `s.nego`(단일)가
     `s.negos`(배열)로 바뀌었는데 이 줄이 옛 필드를 그대로 보고 있었다.
     `undefined` 는 falsy 라 조용히 통과했고, 결과적으로 **협상단 전원이
     expNego(4) 가 아니라 expIdle(1) 을 받고 있었다** — '경험치는 실제로 한
     일에서만 나온다'는 설계가 정반대로 뒤집혀 있었다.
     스모크가 `S.nego` 를 직접 세워 검사하는 바람에 계속 통과했다 (§16-1). */
  const busy = new Set((s.negos || []).map(n => n.slot || 0));
  for (const e of s.staff) {
    const amt = (e.onTeam && busy.has(e.slot || 0)) ? BAL.expNego
      : (e.atShop || (!e.onTeam && managing)) ? BAL.expManage   // 매장 근무도 일이다
        : BAL.expIdle;
    if (gainExp(s, e, amt)) {
      toast(`${e.name} Lv.${e.lv} — 전 능력치 실효 +15%`, 'good');
      pushInbox(s, '승급', `${e.name} 사원이 <b>Lv.${e.lv}</b> 이 되었습니다. 월급이 함께 올랐습니다.`, 'good');
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   고용

   정원을 둔 이유는 "돈이 남으면 계속 뽑는다" 를 막기 위해서다. 자리가 차면
   **누구를 내보낼지** 고르게 되고, 그때 비로소 능력치 비교가 판단이 된다.
   상한 12 는 사무실 책상 수다 — 앉을 자리보다 많이 뽑을 수는 없다.
   ══════════════════════════════════════════════════════════════ */
const staffCap = s => clamp(4 + s.co.tier + facLv(s, 'office') * 2, 4, 12);

/** 모집 비용. 자사 시총 비례 — 고정값이면 후반에 금세 공짜가 된다 */
const hireCost = (s, w) => Math.round(Math.max(3e5, s.co.cap * w.cost));

/**
 * 지원자를 뽑는다. 등급은 회사 규모 + 모집 방법의 가산이다.
 * 비싼 방법일수록 후보 수도 많아 **돈이 확률까지 산다.**
 */
function applicants(s, w) {
  const base = clamp(1 + Math.floor(s.co.tier * 0.8), 1, 5);
  return Array.from({ length: w.pick },
    () => makeStaff(clamp(base + w.bump + (Math.random() < 0.3 ? 1 : 0), 1, 5)));
}

export { applicants, hireCost, staffCap, capCeiling, checkTier, creditIdx, creditName, creditScore, expNeed, gainExp, loanRate, recalcCap, teamPower, tickStaff };
