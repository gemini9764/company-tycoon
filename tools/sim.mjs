/**
 * 밸런스 시뮬레이터.
 *
 * 전략이 다른 봇을 여러 시드로 완주시켜 등급 구간 길이와 엔딩 분포를 본다.
 * 루프 전체를 페이지 안에서 돌려 반복당 브릿지 비용을 없앴다.
 *
 *   node tools/sim.mjs [--runs=2] [--days=4000] [--strats=normal,occult] [--noref]
 *                       [--seeds=101,202,303]
 *
 * **시드는 고정이다.** --seeds 를 안 주면 SEEDS 기본값을 쓴다. 같은 시드에서는
 * 매물 배치·이벤트·인수 판정이 전부 같아서, 밸런스를 고친 전후를 직접 비교할 수
 * 있다. 시드를 안 박던 시절에는 회차마다 ±8% 가 흔들려 비교가 불가능했다.
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
/* 기준 시드 셋. 바꾸면 §6 기준선 표와 비교가 안 되므로 함부로 건드리지 말 것. */
const SEEDS = (argS('seeds', null) || ['1001', '2002', '3003']).map(Number);
const RUNS = arg('runs', SEEDS.length), MAX_DAYS = arg('days', 4000);
const STRATS = argS('strats', ['normal', 'leveraged', 'reckless', 'occult', 'active']);
const NOREF = process.argv.includes('--noref');

const { win, doc } = await boot();
startGame(doc, '시뮬');
win.__desk = process.argv.includes('--desk');
win.__acts = process.argv.includes('--acts');
win.__stake = process.argv.includes('--stake');

// ── 봇 본체는 페이지 안에서 정의한다 ─────────────────────────
win.eval(`
window.runSim = function (strategy, maxDays, seed) {
  const g = window.game, d0 = document;
  const S = g.setS(g.newState('시뮬', seed));
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

  /* ── 능동 운영 (strategy === 'active') ────────────────────────
     단계 1 이 넣은 매각·투자·재편을 봇이 한 번도 쓰지 않아, 계측된 것은
     태그와 업종 퍼크의 **수동적 효과**뿐이었다. 여기서 그 셋을 쓰는 정책을
     붙인다. 판정은 전부 systems/subs.js 의 함수를 그대로 부른다 —
     봇 안에 별도 계산을 두면 UI 플레이와 다른 게임을 재게 된다.

     기획서 §12-1 의 미결정(매각 계수 0.85 가 부실 회생 매각을 흑자로
     만드는가 · 사고팔기 반복이 이득이 되지 않는가)을 재기 위한 정책이다.
     행동 간격을 3·7·5일로 벌려 둔 이유는 하루에 셋이 겹치면 자금이 순식간에
     마르기 때문이다. 한 번에 하나만 한다. */
  const sold = new Set();          // 판 회사를 그날로 되사는 회전을 막는다
  /* 중단한 매물은 다시 잡지 않는다. 실사 결과(t.seen)는 매물에 남으므로 이걸 안 두면
     같은 회사를 잡았다 중단했다를 무한 반복한다 — 실제로 180건 중 142건이 그랬다. */
  const avoid = new Set();
  const ops = { inv: 0, res: 0, sell: 0, sellSum: 0 };
  const acts = { fail: 0, buy: 0, use: {}, spend: 0, starSum: 0, starN: 0, tied: 0 };
  function activeOps(day) {
    const subs = S.co.subs;
    // 1) 투자 — 부실·노후는 수익을 반 토막 내므로 해소가 거의 항상 이득이다
    if (day % 3 === 0) {
      const t = subs.find(c => !c.restruct && g.curableTag(c) && g.pmi(S, c) >= 1
        && S.co.cash > g.investCost(S, c) * 4);
      if (t) { ops.inv++; return g.investSub(S, t); }
    }
    // 2) 재편 — 사업부 문턱에 1개 모자란 업종으로, 혼자 남은 업종의 계열사를 돌린다
    if (day % 7 === 0) {
      const by = g.sectorCount(S);
      const need = Object.keys(by).find(k => by[k] === g.DIV_AT - 1);
      if (need) {
        const from = subs.find(c => !c.restruct && by[c.sector] === 1 && g.pmi(S, c) >= 1
          && !g.subPledged(S, c) && S.co.cash > g.restructCost(S, c) * 6);
        if (from) { ops.res++; return g.restructSub(S, from, need); }
      }
    }
    /* 3) 매각 — **갈아타기가 될 때만** 판다.
       "작은 계열사를 정리한다" 로 잡으면 조건이 사문이 되거나(자금이 남아도는
       후반엔 팔 이유가 없다) 헐값 처분만 반복한다. 매각을 자금원으로 쓰는
       판단은 하나뿐이다 — 지금 살 수 있는 것보다 확실히 큰 매물이 팔면
       손에 들어오는가. 사업부가 깨지는 매각(그 업종이 정확히 3개)은 제외한다. */
    if (!S.nego && subs.length > 5) {
      const ceil = g.capCeiling(S), by = g.sectorCount(S);
      const reach = cash => {
        const t = S.market.filter(x => !x.owned && !sold.has(x.id) && x.cap <= ceil
          && x.cap * 1.55 <= cash * 0.62).sort((a, b) => b.cap - a.cap)[0];
        return t ? t.cap : 0;
      };
      const now = reach(S.co.cash);
      const c = subs.filter(x => !g.canSellSub(S, x) && g.pmi(S, x) >= 1 && by[x.sector] !== g.DIV_AT)
        .sort((a, b) => a.cap - b.cap)
        .find(x => reach(S.co.cash + g.subSellValue(S, x)) > Math.max(now, x.cap) * 2.0);
      if (c) { ops.sell++; ops.sellSum += g.subSellValue(S, c); sold.add(c.id); return g.sellSub(S, c); }
    }
  }

  const marks = {};
  let prevNego = null, nextId = null;
  /* 성공은 더 이상 엔딩이 아니다(무한 진행). 계측은 '시총 1위 도달'에서 끊는다. */
  const done = () => S.flags.ending || S.flags.ms.includes('rank1');
  for (let day = 1; day <= maxDays && !done(); day++) {
    g.tickDay();
    resolve();
    /* 협상 결과 집계 — startNego 보다 **먼저** 봐야 한다. 같은 날 다음 협상이
       시작되면 S.nego 가 다시 차서 방금 끝난 건이 집계에서 사라진다. */
    if (prevNego && !S.nego) (S.co.subs.some(c => c.id === prevNego) ? acts.buy++ : acts.fail++);

    // 인수 판단 — 전략별로 감당할 자금 배수가 다르다
    if (strategy === 'active') activeOps(day);

    /* 미리 사두기 — 협상이 도는 동안 **다음 대상**에 밑밥을 깐다.
       대상을 매일 새로 고르면 매집한 회사와 실제로 협상을 거는 회사가 어긋나
       돈만 여기저기 묶인다(첫 정책이 그랬다 — 협상 시작 시 평균 ★0.7).
       한 번 정한 대상을 붙들고, 그 대상에 협상을 건다.
       소문 문턱 직전에서 멈춘다 — 넘기면 난이도가 올라 매집한 값어치를 반납한다. */
    if (window.__stake) {
      /* 지금 협상 중인 회사는 제외한다. 인수되면 지분이 흡수되므로 헛돈이다 */
      const ok = x => x && !x.owned && !avoid.has(x.id)
        && x.id !== (S.nego && S.nego.id) && x.cap <= g.capCeiling(S);
      let t = S.market.find(x => x.id === nextId);
      if (!ok(t)) {
        /* 다음 대상은 **지금 협상에 쓸 돈을 뺀 나머지**로 감당되는 것이어야 한다.
           현재 현금 기준으로 고르면 인수 대금이 빠진 뒤 그 대상을 못 사고
           매집한 돈이 통째로 버려진다.

           비상장 매물도 대상이다 — 장외 지분 매입 경로가 열려 있다.
           (그 전에는 상장사만 대상이라 중소기업 구간에서 평균 ★0.7 이었다.) */
        const cur = S.nego ? (S.market.find(x => x.id === S.nego.id)?.cap || 0) * 1.4 : 0;
        const left = Math.max(0, S.co.cash - cur);
        t = S.market.filter(x => ok(x) && x.cap * 1.55 <= left * 0.62)
          .sort((a, b) => b.cap - a.cap)[0];
        nextId = t ? t.id : null;
      }
      for (const id of Object.keys(S.stock.stake || {})) {
        const c = S.market.find(x => x.id === id);
        if (!c || c.id !== nextId || g.stakeStars(S, c) >= g.BAL.stakeLeakAt - 1) g.toggleStake(S, c);
      }
      if (t && !S.stock.stake[t.id] && g.stakeStars(S, t) < g.BAL.stakeLeakAt - 1) g.toggleStake(S, t);
    }

    /* 협상 중 능동 개입 — 기본 봇은 쓰지 않는다(기준선을 바꾸지 않으려고).
       --acts 로 켜면 '개입까지 챙기는 플레이'를 잰다. --desk 와 같은 관례다.

       **봇은 숨은 태그를 미리 보지 않는다.** hasHidden 으로 실사 여부를
       정하면 정보를 공짜로 얻는 셈이라 실사의 대가가 계측에서 사라진다.
       자금이 넉넉하면 무조건 한 번 실사하고, 드러난 것만 판단에 쓴다. */
    if (window.__acts && S.nego) {
      const n = S.nego, t = S.market.find(c => c.id === n.id);
      const did = k => (n.done || []).includes(k);
      const rich = m => S.co.cash > g.NEGO_ACTS[m].cost(S, n) * 8;
      const use = k => { const c = g.NEGO_ACTS[k].cost(S, n); if (g.negoAct(S, k)) { acts.use[k] = (acts.use[k] || 0) + 1; acts.spend += c; } };
      const bad = (t?.seen || []).includes('debt');
      /* 실사를 협상마다 쓰면 개입 3회 중 1회가 고정 소모된다 (기획서 §12-3의 우려).
         계측해 보니 습관적 실사는 진행도만 깎아 순손실이었다 — **큰 건에만** 쓴다. */
      const heavy = g.NEGO_ACTS.quit.cost(S, n) / g.BAL.negoQuitFee > S.co.cash * 0.35;
      if (!did('audit') && heavy && n.progress >= 15 && n.progress < 45 && rich('audit')) use('audit');
      /* 손절 조건. 진행 50% 시점에 성공도로 판단하면 **너무 이르다** — 성공도는
         남은 날 동안 계속 오르므로 아직 진 판이 아니다(초기 정책이 이걸 놓쳐
         180건 중 155건을 중단했다). 중단의 값어치는 두 곳에만 있다:
         정말 진 판(진행 60%에 성공도 20 미만)과, 실사로 우발채무를 본 직후. */
      else if ((n.progress >= 60 && n.success < 20) || (bad && n.progress < 60)) { avoid.add(n.id); use('quit'); }
      else if (!did('wine') && n.progress >= 65 && n.success < 60 && rich('wine')) use('wine');
      else if (n.success >= 88 && n.progress < 65) use('push');
    }

    if (!S.nego && !done()) {
      const mult = strategy === 'reckless' ? 3 : strategy === 'leveraged' ? 1.5 : 0.62;
      const budget = S.co.cash * mult;
      const pool = S.market
        .filter(x => !x.owned && !sold.has(x.id) && !avoid.has(x.id) && x.cap <= g.capCeiling(S) && x.cap * 1.55 <= budget);
      // 밑밥을 깐 대상이 아직 감당 가능하면 그쪽을 먼저 잡는다
      const c = (window.__stake && pool.find(x => x.id === nextId)) || pool.sort((a, b) => b.cap - a.cap)[0];
      if (c) {
        if (window.__stake) { acts.starSum += g.stakeStars(S, c); acts.starN++; nextId = null; }
        g.startNego(S, c);
      }
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
    prevNego = S.nego ? S.nego.id : null;
    if (marks['t' + S.co.tier] === undefined) marks['t' + S.co.tier] = day;
  }
  return {
    seed: S.seed, days: S.day, tier: g.TIERS[S.co.tier].name, ending: S.flags.ending || '미종료',
    subs: S.co.subs.length, total: S.market.length, cap: g.won(S.co.cap), rank: S.co.rank,
    syn: S.co.synergy.toFixed(2), mistrust: Math.round(S.co.mistrust),
    probe: Math.round(S.co.probe), marks, ops, acts,
    tied: Object.keys(S.stock.holds).reduce((a, id) => { const c = S.market.find(x => x.id === id); return a + (c ? S.stock.holds[id].qty * c.price : 0); }, 0),
  };
};
`);

const run = (s, seed, days = MAX_DAYS) => win.runSim(s, days, seed);

// ── 등급 구간 ────────────────────────────────────────────────
if (!NOREF) {
  const refs = SEEDS.map(sd => run('normal', sd));
  console.log(`=== 등급 구간 (무차입 전략 · 시드 ${SEEDS.join(' / ')}) ===`);
  console.log('등급'.padEnd(11) + SEEDS.map(sd => String(sd).padStart(9)).join('') + '     구간(평균)');
  const keys = [...new Set(refs.flatMap(r => Object.keys(r.marks)))]
    .sort((a, b) => refs[0].marks[a] - refs[0].marks[b]);
  /* 한 줄의 '구간' 은 **그 등급에 머문 일수** 다 — 다음 등급 도달일에서 이 등급
     도달일을 뺀다. 예전에는 직전 줄의 도달일을 빼서 한 칸씩 밀려 있었고,
     그래서 "중견기업 287일" 로 읽히던 값이 실제로는 중소기업 구간이었다.
     라벨과 계산을 다시 어긋내지 말 것. */
  for (let x = 0; x < keys.length; x++) {
    const k = keys[x], next = keys[x + 1];
    const name = win.game.TIERS[+k.slice(1)].name;
    const days = refs.map(r => r.marks[k]);
    const gaps = days.map((d, i) => {
      const end = next ? refs[i].marks[next] : refs[i].days;
      return (d === undefined || end === undefined) ? NaN : end - d;
    });
    const avg = gaps.filter(g => !isNaN(g));
    console.log(name.padEnd(9) + days.map(d => String(d ?? '-').padStart(9)).join('') +
      '   ' + String(Math.round(avg.reduce((a, b) => a + b, 0) / (avg.length || 1))).padStart(6) + '일');
  }
}

// ── 전략별 결과 ──────────────────────────────────────────────
console.log('\n=== 전략별 결과 ===');
console.log('전략        일수   등급        엔딩       계열사   시총      순위  효율  미신  수사');
const plan = [];
for (const s of STRATS) {
  for (let i = 0; i < RUNS; i++) plan.push([s, SEEDS[i % SEEDS.length]]);
}
for (const [s, sd] of plan) {
  const r = run(s, sd);
  if (r.ops && (r.ops.inv + r.ops.res + r.ops.sell)) console.log(`   \u2514 \uB2A5\uB3D9 \uC6B4\uC601: \uD22C\uC790 ${r.ops.inv} \u00B7 \uC7AC\uD3B8 ${r.ops.res} \u00B7 \uB9E4\uAC01 ${r.ops.sell} (${win.game.won(r.ops.sellSum)})`);
  console.log(`   \u2514 \uD611\uC0C1: \uC131\uC0AC ${r.acts.buy} \u00B7 \uACB0\uB82C/\uC911\uB2E8 ${r.acts.fail} (\uACB0\uB82C\uB960 ${Math.round(r.acts.fail / Math.max(1, r.acts.buy + r.acts.fail) * 100)}%)` +
    (r.acts.spend ? ` \u00B7 \uAC1C\uC785 ${JSON.stringify(r.acts.use)} \uC9C0\uCD9C ${win.game.won(r.acts.spend)}` : '') +
    (r.acts.starN ? ` \u00B7 \uD3C9\uADE0 \u2605${(r.acts.starSum / r.acts.starN).toFixed(1)} \u00B7 \uBB36\uC778 \uB3C8 ${win.game.won(r.tied)}` : ''));
  console.log(
    `${(s + '·' + sd).padEnd(11)} ${String(r.days).padStart(4)}  ${r.tier.padEnd(10)} ${r.ending.padEnd(9)}` +
    ` ${String(r.subs + '/' + r.total).padStart(6)}  ${r.cap.padStart(8)} ${String(r.rank).padStart(5)}` +
    `  ${r.syn}  ${String(r.mistrust).padStart(3)}  ${String(r.probe).padStart(4)}`);
}
process.exit(0);
