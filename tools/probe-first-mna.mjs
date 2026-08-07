/**
 * 첫 M&A 까지 걸리는 시간의 병목을 잰다.
 *
 * 등급 잠금은 없다 — 구멍가게(등급 0)도 capCeiling 3억까지 인수할 수 있다.
 * 그러니 늦는 이유는 "권한"이 아니라 "최저 매물값 대비 초반 자금"이다.
 * 그 둘을 나란히 찍는다.
 */
import { boot } from './harness.mjs';

const { win } = await boot();
const out = win.eval(`(() => {
  const g = window.game, rows = [];
  for (const seed of [1001, 2002, 3003, 4004, 5005, 6006]) {
    const S = g.setS(g.newState('probe', seed));
    S.co.autoOrder = true;
    S.staff.forEach(e => { e.onTeam = true; e.slot = 0; });
    const sorted = S.market.filter(c => !c.owned).sort((a, b) => a.cap - b.cap);
    const t = sorted[0];
    const price = Math.round(t.cap * (1 + g.DIFFS[t.diff].prem));
    // 자기자금만으로 최저 매물의 인수가에 닿는 날
    let day = 0, reach = null, tierUp = null;
    while (day < 400 && reach === null) {
      g.tickDay(); day++;
      if (tierUp === null && S.co.tier >= 1) tierUp = day;
      if (S.co.cash >= price) reach = day;
    }
    rows.push({
      seed,
      '최저매물': Math.round(t.cap / 1e4) + '만',
      '인수가': Math.round(price / 1e4) + '만',
      '하위4개': sorted.slice(0, 4).map(c => Math.round(c.cap / 1e4) + '만').join(' '),
      '동네슈퍼': tierUp + '일',
      '자기자금 도달': reach === null ? '400일+' : reach + '일',
    });
  }
  return rows;
})()`);
console.table(out);
