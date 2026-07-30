/* ── 등급 테이블 ─────────────────────────────────────────── */
const netWorth = s => s.co.cash - debtTotal(s);

/* ══════════════════════════════════════════════════════════════
   SYSTEMS — 순수 상태 변형 함수. 렌더는 건드리지 않는다.
   ══════════════════════════════════════════════════════════════ */

/* ── 파생 스탯 ───────────────────────────────────────────── */
const teamOf   = s => s.staff.filter(e => e.onTeam);

const sumStat  = (list, k) => list.reduce((a, e) => a + e[k] * (1 + (e.lv - 1) * 0.15), 0);

const debtTotal = s => s.bank.loans.reduce((a, l) => a + l.left, 0);

export { debtTotal, netWorth, sumStat, teamOf };
