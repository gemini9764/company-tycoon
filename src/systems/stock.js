import { BAL } from '../core/balance.js';
import { $, rnd, won } from '../core/util.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ── 주식 ────────────────────────────────────────────────── */
function tickStock(s) {
  s.market.forEach(c => {
    if (!c.listed || c.owned) return;
    const vol = c.curse > 0 ? rnd(-0.09, 0.01) : rnd(-0.028, 0.031);
    c.price = Math.max(10, Math.round(c.price * (1 + vol)));
  });
}

function buyStock(s, c, qty) {
  const cost = c.price * qty;
  if (s.co.cash < cost) return toast('자금이 부족합니다', 'bad');
  s.co.cash -= cost;
  const h = s.stock.holds[c.id] || { qty: 0, avg: 0 };
  h.avg = (h.avg * h.qty + cost) / (h.qty + qty); h.qty += qty;
  s.stock.holds[c.id] = h;
  toast(`${c.name} ${qty}주 매수`, 'good');
}

function sellStock(s, c, qty) {
  const h = s.stock.holds[c.id]; if (!h || h.qty < qty) return;
  s.co.cash += c.price * qty; h.qty -= qty;
  const pl = (c.price - h.avg) * qty;
  if (h.qty <= 0) delete s.stock.holds[c.id];
  toast(`${c.name} ${qty}주 매도 · 손익 ${pl >= 0 ? '+' : ''}${won(pl)}`, pl >= 0 ? 'good' : 'bad');
}

export { buyStock, sellStock, tickStock };

/* ══════════════════════════════════════════════════════════════
   미리 사두기 — 지분 매집의 캐주얼 포장

   `stock.holds` 를 `mna.js` 가 어디서도 참조하지 않아 주식이 별도의 돈놀이로
   떠 있었다 (남은 과제 6번). 여기서 두 축을 잇는다.

   원안(공시 의무·5% 룰·분산 매집)은 전문 용어가 그대로 노출된다.
   **메커니즘만 살리고 조작과 어휘를 전부 바꿨다** — 조작은 토글 하나,
   화면에 뜨는 숫자는 별 개수 하나, 노출되는 원어는 0개다.

   판정은 전부 여기 순수 함수에 있다. sim 봇이 같은 함수를 부른다.
   ══════════════════════════════════════════════════════════════ */

/** 구버전 세이브에는 stake·priv 가 없다. 읽는 쪽마다 여기를 거친다 */
const stakeMap = s => (s.stock.stake ||= {});
/** 비상장 지분 투입 누계 { 회사id: 금액 } */
const privMap  = s => (s.stock.priv ||= {});

/**
 * 보유 지분율.
 * - 상장사: 주가 × 수량 / 시총 — 기존 holds 를 그대로 쓴다
 * - 비상장사: **장외 지분 매입**. 주가가 없으므로 투입 금액 누계 / 시총 으로 센다
 *
 * 287일이 걸리는 중소기업 구간에서 사는 매물(2억~110억)은 전부 비상장이라,
 * 상장사만 열어 두면 이 기능이 후반에만 걸린다. 상장 기준(LIST_TIER)을 낮추는
 * 대신 비상장 경로를 따로 뚫었다 — 상장 기준은 사용자 요구사항이다.
 */
function stakeRatio(s, c) {
  if (!c.listed) return (privMap(s)[c.id] || 0) / Math.max(1, c.cap);
  const h = s.stock.holds[c.id];
  return h ? (h.qty * c.price) / Math.max(1, c.cap) : 0;
}

/** 비상장 지분 투입액 (되팔기·표시용) */
const privAmt = (s, c) => privMap(s)[c.id] || 0;

/** 0~5. 비율을 % 로 보여주지 않는 이유는 기획서 §2 원칙 3 */
function stakeStars(s, c) {
  return Math.min(BAL.stakeStars, Math.floor(stakeRatio(s, c) / BAL.stakePerStar));
}

const staking = (s, c) => !!stakeMap(s)[c.id];

function toggleStake(s, c) {
  const m = stakeMap(s);
  const what = c.listed ? '주식' : '지분';
  if (m[c.id]) { delete m[c.id]; toast(`${c.name} 매집 중단`); }
  else { m[c.id] = true; toast(`${c.name} ${what}을(를) 조금씩 사둡니다`, 'good'); }
}

/**
 * 하루치 매집. 플레이어가 매수 타이밍을 판단할 일이 없도록 자동으로 나간다.
 * **자금이 모자라면 조용히 멈추지 않는다** — 알림 없이 꺼지면 이유를 모른다.
 */
function tickStake(s) {
  const m = stakeMap(s);
  for (const id of Object.keys(m)) {
    const c = s.market.find(x => x.id === id);
    if (!c || c.owned) { delete m[id]; continue; }
    if (stakeStars(s, c) >= BAL.stakeStars) continue;          // 상한에 닿으면 쉰다

    const spend = c.cap * BAL.stakeStep;
    if (s.co.cash < spend) {
      delete m[id];
      toast(`자금 부족 — ${c.name} 매집을 멈췄습니다`, 'bad');
      pushInbox(s, '매집 중단', `${c.name} ${c.listed ? '주식' : '지분'} 매집에 필요한 ${won(spend)}이(가) 모자라 자동으로 멈췄습니다. 사둔 지분은 그대로 남아 있습니다.`, 'bad');
      continue;
    }
    if (c.listed) {
      const qty = Math.floor(spend / c.price);
      if (qty <= 0) continue;
      s.co.cash -= qty * c.price;
      const h = s.stock.holds[c.id] || { qty: 0, avg: 0 };
      h.avg = (h.avg * h.qty + qty * c.price) / (h.qty + qty); h.qty += qty;
      s.stock.holds[c.id] = h;
    } else {
      s.co.cash -= spend;
      privMap(s)[c.id] = (privMap(s)[c.id] || 0) + spend;
    }
    if (stakeStars(s, c) >= BAL.stakeLeakAt) leak(s, c);
  }
}

/* 소문 — 원안의 '5% 공시 의무'가 놓인 자리. 뉴스 한 줄과 주가 급등으로만 낸다.
   난이도가 오르므로 **적당히 사고 멈추는 것**이 정답이 되는 지점이 생긴다. */
function leak(s, c) {
  if (c.leak) return;
  c.leak = true;
  // 비상장사는 주가가 없다. 인수가 상승(stakeLeakPrem)과 난이도만 걸린다
  if (c.listed) c.price = Math.round(c.price * (1 + BAL.stakeLeakPrice));
  c.diff = Math.min(3, c.diff + 1);
  news(`${s.co.name}, ${c.name} 지분 확대 관측`);
  toast(c.listed ? `${c.name} 주가 급등 — 인수가가 올랐습니다` : `${c.name} 인수가가 올랐습니다`, 'bad');
  pushInbox(s, '지분 확대 관측', `${c.name} 지분을 사 모으는 것이 알려졌습니다. ${c.listed ? '주가가 오르고 ' : '인수가가 오르고 '}인수 난이도가 한 단계 올라갔습니다.`, 'bad');
}

/** 협상 시작 시 얹히는 값. mna.js 가 이것만 보면 된다 */
function stakeBonus(s, c) {
  const st = stakeStars(s, c);
  return { stars: st, success: st * BAL.stakeSuccess,
           prem: -st * BAL.stakePrem + (c.leak ? BAL.stakeLeakPrem : 0) };
}

/** 인수가 끝나면 사둔 지분은 인수에 흡수된다 */
function clearStake(s, id) {
  delete stakeMap(s)[id];
  delete s.stock.holds[id];
  delete privMap(s)[id];
}

/**
 * 비상장 지분 되팔기. 장외라 제값을 못 받는다 —
 * 결렬이 전손은 아니되 공짜 옵션도 아니게 만드는 지점.
 */
function sellPrivStake(s, c) {
  const amt = privAmt(s, c);
  if (!amt) return;
  const back = Math.round(amt * BAL.stakePrivSell);
  s.co.cash += back;
  delete privMap(s)[c.id];
  delete stakeMap(s)[c.id];
  const pl = back - amt;
  toast(`${c.name} 지분 매각 · 손익 ${pl >= 0 ? '+' : ''}${won(pl)}`, pl >= 0 ? 'good' : 'bad');
}

export { clearStake, privAmt, sellPrivStake, stakeBonus, stakeRatio, stakeStars, staking, tickStake, toggleStake };
