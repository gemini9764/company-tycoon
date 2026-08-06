/* ── 등급 테이블 ─────────────────────────────────────────── */
const netWorth = s => s.co.cash - debtTotal(s);

/* ══════════════════════════════════════════════════════════════
   SYSTEMS — 순수 상태 변형 함수. 렌더는 건드리지 않는다.
   ══════════════════════════════════════════════════════════════ */

/* ── 파생 스탯 ───────────────────────────────────────────── */
const teamOf   = s => s.staff.filter(e => e.onTeam);

/* 직원 배치는 셋이다 — **협상단 / 매장 근무 / 계열사 관리.**
   `onTeam` 과 `atShop` 둘 다 아니면 관리다. 새 필드를 하나만 더해 셋을 만들면
   구버전 세이브(atShop 없음)가 그대로 예전 이분법으로 읽히고, sim 봇도
   onTeam 만 건드리므로 기존 기준선이 무효가 되지 않는다. */
const shopOf   = s => s.staff.filter(e => e.atShop && !e.onTeam);
const mgrOf    = s => s.staff.filter(e => !e.onTeam && !e.atShop);

const sumStat  = (list, k) => list.reduce((a, e) => a + e[k] * (1 + (e.lv - 1) * 0.15), 0);

const debtTotal = s => s.bank.loans.reduce((a, l) => a + l.left, 0);

export { debtTotal, netWorth, sumStat, mgrOf, shopOf, teamOf };
