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

/** 구버전 세이브에는 stake 가 없다. 읽는 쪽마다 여기를 거친다 */
const stakeMap = s => (s.stock.stake ||= {});

/** 보유 지분율. 주가 × 수량 / 시총 — 기존 holds 를 그대로 쓴다 */
function stakeRatio(s, c) {
  const h = s.stock.holds[c.id];
  return h ? (h.qty * c.price) / Math.max(1, c.cap) : 0;
}

/** 0~5. 비율을 % 로 보여주지 않는 이유는 기획서 §2 원칙 3 */
function stakeStars(s, c) {
  return Math.min(BAL.stakeStars, Math.floor(stakeRatio(s, c) / BAL.stakePerStar));
}

const staking = (s, c) => !!stakeMap(s)[c.id];

function toggleStake(s, c) {
  if (!c.listed) return toast('비상장 회사는 주식을 사둘 수 없습니다', 'bad');
  const m = stakeMap(s);
  if (m[c.id]) { delete m[c.id]; toast(`${c.name} 매집 중단`); }
  else { m[c.id] = true; toast(`${c.name} 주식을 조금씩 사둡니다`, 'good'); }
}

/**
 * 하루치 매집. 플레이어가 매수 타이밍을 판단할 일이 없도록 자동으로 나간다.
 * **자금이 모자라면 조용히 멈추지 않는다** — 알림 없이 꺼지면 이유를 모른다.
 */
function tickStake(s) {
  const m = stakeMap(s);
  for (const id of Object.keys(m)) {
    const c = s.market.find(x => x.id === id);
    if (!c || c.owned || !c.listed) { delete m[id]; continue; }
    if (stakeStars(s, c) >= BAL.stakeStars) continue;          // 상한에 닿으면 쉰다

    const spend = c.cap * BAL.stakeStep;
    if (s.co.cash < spend) {
      delete m[id];
      toast(`자금 부족 — ${c.name} 매집을 멈췄습니다`, 'bad');
      pushInbox(s, '매집 중단', `${c.name} 주식 매집에 필요한 ${won(spend)}이(가) 모자라 자동으로 멈췄습니다. 사둔 지분은 그대로 남아 있습니다.`, 'bad');
      continue;
    }
    const qty = Math.floor(spend / c.price);
    if (qty <= 0) continue;
    s.co.cash -= qty * c.price;
    const h = s.stock.holds[c.id] || { qty: 0, avg: 0 };
    h.avg = (h.avg * h.qty + qty * c.price) / (h.qty + qty); h.qty += qty;
    s.stock.holds[c.id] = h;
    if (stakeStars(s, c) >= BAL.stakeLeakAt) leak(s, c);
  }
}

/* 소문 — 원안의 '5% 공시 의무'가 놓인 자리. 뉴스 한 줄과 주가 급등으로만 낸다.
   난이도가 오르므로 **적당히 사고 멈추는 것**이 정답이 되는 지점이 생긴다. */
function leak(s, c) {
  if (c.leak) return;
  c.leak = true;
  c.price = Math.round(c.price * (1 + BAL.stakeLeakPrice));
  c.diff = Math.min(3, c.diff + 1);
  news(`${s.co.name}, ${c.name} 지분 확대 관측`);
  toast(`${c.name} 주가 급등 — 인수가가 올랐습니다`, 'bad');
  pushInbox(s, '지분 확대 관측', `${c.name} 주식을 사 모으는 것이 알려졌습니다. 주가가 오르고 인수 난이도가 한 단계 올라갔습니다.`, 'bad');
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
}

export { clearStake, stakeBonus, stakeRatio, stakeStars, staking, tickStake, toggleStake };
