/**
 * 밸런스 시뮬레이터.
 *
 * 전략이 다른 봇을 여러 시드로 완주시켜 등급 구간 길이와 엔딩 분포를 본다.
 * 루프 전체를 페이지 안에서 돌려 반복당 브릿지 비용을 없앴다.
 *
 *   node tools/sim.mjs [--runs=2] [--days=4000] [--strats=normal,occult] [--noref]
 *
 * 한 판이 수 초, 부팅이 수십 초다. 실행 시간을 제한받는 환경에서는 --strats 로
 * 전략을 나눠 여러 번 돌리고 결과를 합친다. --noref 는 등급 구간 측정을 건너뛴다.
 */
import { boot, startGame } from './harness.mjs';

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? Number(m.split('=')[1]) : d;
};
const argS = (k, d) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1].split(',') : d;
};
const RUNS = arg('runs', 2), MAX_DAYS = arg('days', 4000);
const STRATS = argS('strats', ['normal', 'leveraged', 'reckless', 'occult']);
const NOREF = process.argv.includes('--noref');

const { win, doc } = await boot();
startGame(doc, '시뮬');
win.__desk = process.argv.includes('--desk');

// ── 봇 본체는 페이지 안에서 정의한다 ─────────────────────────
win.eval(`
window.runSim = function (strategy, maxDays) {
  const g = window.game, d0 = document;
  const S = g.setS(g.newState('시뮬'));
  S.speed = 0;
  S.staff.forEach(e => e.onTeam = true);
  /* 재고를 방치하면 매출이 stockFloor 까지 떨어진다. 봇은 '관리는 하는' 플레이를
     대표해야 하므로 자동 발주를 켠다 — 단가 할증까지 포함한 보수적인 기준선이다. */
  S.co.autoOrder = true;

  // 모달이 열리면 전략에 맞는 선택지를 누른다
  function resolve() {
    let guard = 0;
    while (d0.getElementById('modal-layer').classList.contains('on') && guard++ < 8) {
      const cs = [...d0.querySelectorAll('#modal .choice:not([disabled])')];
      let pick = cs[0];
      if (strategy === 'reckless') {
        pick = cs.find(c => /로비|무대응|대출/.test(c.textContent)) || cs[0];
      }
      const act = [...d0.querySelectorAll('#modal [data-a]')]
        .find(b => !/새 게임/.test(b.textContent));   // 엔딩 모달의 재시작은 누르지 않는다
      const btn = pick || act;
      if (!btn) break;
      btn.click();
    }
  }

  const marks = {};
  /* 성공은 더 이상 엔딩이 아니다(무한 진행). 계측은 '시총 1위 도달'에서 끊는다. */
  const done = () => S.flags.ending || S.flags.ms.includes('rank1');
  for (let day = 1; day <= maxDays && !done(); day++) {
    g.tickDay();
    resolve();

    // 인수 판단 — 전략별로 감당할 자금 배수가 다르다
    if (!S.nego && !done()) {
      const mult = strategy === 'reckless' ? 3 : strategy === 'leveraged' ? 1.5 : 0.62;
      const budget = S.co.cash * mult;
      const c = S.market
        .filter(x => !x.owned && x.cap <= g.capCeiling(S) && x.cap * 1.55 <= budget)
        .sort((a, b) => b.cap - a.cap)[0];
      if (c) g.startNego(S, c);
    }
    // 협상단 3명 + 계열사 관리 인력을 채운다
    const want = 3 + g.managersNeeded(S);
    if (S.staff.length < want && S.co.cash > (S.recruits[0]?.salary || 1e9) * 30) {
      if (!S.recruits.length) {
        const lv = g.clamp(1 + Math.floor(S.co.tier * 0.8), 1, 5);
        S.recruits = [g.makeStaff(lv), g.makeStaff(lv), g.makeStaff(lv)];
      }
      const e = S.recruits.shift();
      e.onTeam = g.teamOf(S).length < 3;
      S.co.cash -= e.salary * 3;
      S.staff.push(e);
    }
    // 운영 효율 관리
    if (S.co.subs.length && S.co.auditBuff < g.BAL.auditCap * 0.6) {
      const cost = g.auditCost(S);
      if (S.co.cash > cost * 25) {
        S.co.cash -= cost;
        S.co.auditBuff = Math.min(g.BAL.auditCap, (S.co.auditBuff || 0) + g.BAL.auditGain);
      }
    }
    // 인지도 유지
    if (day % 20 === 0 && S.co.marketing < 2.0) {
      const cost = g.adCost(S, 3);
      if (S.co.cash > cost * 20) {
        S.co.cash -= cost;
        S.co.marketing = Math.min(g.BAL.marketingCap, S.co.marketing + 0.36);
      }
    }
    // 무속 루트는 협상마다 축원굿을 올린다
    if (strategy === 'occult' && S.shaman.unlocked) {
      if (!S.shaman.hired) S.shaman.hired = S.shaman.pool[S.shaman.pool.length - 1];
      if (S.nego && day % 9 === 0 && S.co.cash > g.shamanFee(S, S.shaman.hired) * 3) {
        g.doGut(S, 'bless');
      }
    }
    /* 사장실 결재 — 리스크를 내리는 유일한 수단. 기본 봇은 쓰지 않는다(기준선을
       바꾸지 않으려고). --desk 로 켜면 '결재까지 챙기는 플레이'를 잰다. */
    if (window.__desk && S.co.deskDay !== S.day) {
      const need = S.co.mistrust >= 45 ? 'donate' : S.co.probe >= 40 ? 'press' : null;
      const it = need && g.ITEMS.find(x => x.id === need);
      if (it) {
        const c = g.deskCost(S, it.mul);
        if (S.co.cash > c * 6) { S.co.cash -= c; S.co.deskDay = S.day; it.run(S); }
      }
    }
    if (marks['t' + S.co.tier] === undefined) marks['t' + S.co.tier] = day;
  }
  return {
    days: S.day, tier: g.TIERS[S.co.tier].name, ending: S.flags.ending || '미종료',
    subs: S.co.subs.length, total: S.market.length, cap: g.won(S.co.cap), rank: S.co.rank,
    syn: S.co.synergy.toFixed(2), mistrust: Math.round(S.co.mistrust),
    probe: Math.round(S.co.probe), marks,
  };
};
`);

const run = (s, days = MAX_DAYS) => win.runSim(s, days);

// ── 등급 구간 ────────────────────────────────────────────────
if (!NOREF) {
  const ref = run('normal');
  console.log('=== 등급 구간 (무차입 전략) ===');
  let prev = 0;
  for (const k of Object.keys(ref.marks).sort((a, b) => ref.marks[a] - ref.marks[b])) {
    const day = ref.marks[k];
    const name = win.game.TIERS[+k.slice(1)].name;
    console.log(`${name.padEnd(6)} ${String(day).padStart(5)}일   구간 ${String(day - prev).padStart(4)}일`);
    prev = day;
  }
}

// ── 전략별 결과 ──────────────────────────────────────────────
console.log('\n=== 전략별 결과 ===');
console.log('전략        일수   등급        엔딩       계열사   시총      순위  효율  미신  수사');
const plan = [];
for (const s of STRATS) {
  for (let i = 0; i < RUNS; i++) plan.push(s);
}
for (const s of plan) {
  const r = run(s);
  console.log(
    `${s.padEnd(11)} ${String(r.days).padStart(4)}  ${r.tier.padEnd(10)} ${r.ending.padEnd(9)}` +
    ` ${String(r.subs + '/' + r.total).padStart(6)}  ${r.cap.padStart(8)} ${String(r.rank).padStart(5)}` +
    `  ${r.syn}  ${String(r.mistrust).padStart(3)}  ${String(r.probe).padStart(4)}`);
}
process.exit(0);
