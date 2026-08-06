/* ── 등급 테이블 ─────────────────────────────────────────── */
/**
 * 순자산 = 보유 자금 + 계열사 가치 − 부채.
 *
 * 예전에는 현금에서 부채만 뺐다. 그래서 **계열사를 아무리 사도 순자산이 늘지
 * 않았고**, 7개 등급 중 4개의 승급 조건이 순자산이라 게임의 메인 행동이 승급
 * 게이지를 역행시켰다 (계열사 23개 · 시총 34조 시점에도 순자산 = 현금).
 *
 * 본업(매장) 가치는 여기 넣지 않는다 — "보유 자금 + 계열사 − 빚" 한 문장으로
 * 설명이 끝나야 한다. 본업은 시가총액 쪽에만 얹는다 (systems/company.js).
 */
const subsValue = s => s.co.subs.reduce((a, c) => a + c.cap, 0);

const netWorth = s => s.co.cash + subsValue(s) - debtTotal(s);

/**
 * 자산 총계 — 부채를 빼기 전, **본업 기대수익이 섞이지 않은 실물 자산**이다.
 *
 * 은행과 신용평가는 이 값을 본다. 시가총액에는 매장 수익의 8배 자본화가 들어
 * 있는데, 그것을 담보로 잡으면 "앞으로 벌 돈"으로 지금 빌리는 셈이 된다.
 * 실제로 순자산 정의를 고칠 때 시총이 부풀면서 한도·신용·보험금이 한꺼번에
 * 헐거워져 reckless 의 파산이 1/3 → 0/3 으로 사라졌다.
 */
const grossAssets = s => s.co.cash + subsValue(s);

/* ══════════════════════════════════════════════════════════════
   SYSTEMS — 순수 상태 변형 함수. 렌더는 건드리지 않는다.
   ══════════════════════════════════════════════════════════════ */

/* ── 파생 스탯 ───────────────────────────────────────────── */
/**
 * 협상단.
 *
 *   teamOf(s)     — 협상단 전원 (관리 인력 계산이 이걸 쓴다)
 *   teamOf(s, 0)  — 1팀만 · teamOf(s, 1) — 2팀만
 *
 * `onTeam` 을 슬롯 번호로 갈아엎지 않고 `slot` 을 얹은 이유는, 관리 인력이
 * "협상단에 안 들어간 직원"으로 계산되기 때문이다. 기존 의미를 그대로 두면
 * economy·tabs·sim 쪽 계산을 손대지 않아도 된다.
 */
const teamOf = (s, slot) =>
  s.staff.filter(e => e.onTeam && (slot === undefined || (e.slot || 0) === slot));

/* 직원 배치는 셋이다 — **협상단 / 매장 근무 / 계열사 관리.**
   `onTeam` 과 `atShop` 둘 다 아니면 관리다. 새 필드를 하나만 더해 셋을 만들면
   구버전 세이브(atShop 없음)가 그대로 예전 이분법으로 읽히고, sim 봇도
   onTeam 만 건드리므로 기존 기준선이 무효가 되지 않는다. */
const shopOf   = s => s.staff.filter(e => e.atShop && !e.onTeam);
const mgrOf    = s => s.staff.filter(e => !e.onTeam && !e.atShop);

const sumStat  = (list, k) => list.reduce((a, e) => a + e[k] * (1 + (e.lv - 1) * 0.15), 0);

const debtTotal = s => s.bank.loans.reduce((a, l) => a + l.left, 0);

export { debtTotal, grossAssets, netWorth, subsValue, sumStat, mgrOf, shopOf, teamOf };
