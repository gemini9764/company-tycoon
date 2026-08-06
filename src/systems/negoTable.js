import { BAL } from '../core/balance.js';
import { rand } from '../core/rng.js';
import { clamp } from '../core/util.js';

/* ══════════════════════════════════════════════════════════════
   협상 테이블 — 클로징에서 열리는 손패 게임

   287일이 걸리는 중소기업 구간은 시간의 86~99%가 '협상 중'이다. 그런데 그
   15일은 완전 자동이라 플레이어가 볼 것이 진행 막대뿐이었다. 협상 그 자체를
   판단거리로 만드는 것이 그 구간에 개입을 넣는 유일한 직접 수단이다.

   **규모로 분기하지 않는다.** 기획서 원안(난이도 중 이상 또는 등급 상한 60%)을
   이 구간에 대입하면 상한 60% 선이 1,200억인데 매물은 최대 109억이라 규모
   조건은 0건, 난이도 조건으로 4~5건만 열린다 — 57일에 한 번이다.
   대신 **파견 시 플레이어가 고른다**: 직접 협상 / 협상단에 위임.

   **위임에 페널티를 두지 않는다.** 페널티가 있으면 '항상 직접'이 정답이 되어
   선택이 사라지고 반복 피로만 남는다. 위임은 무작위 선택의 기대값과 같다 —
   트레이드오프가 시간 대 성과로 정직해진다.

   판정은 전부 이 파일의 순수 함수다. UI 는 껍데기이고 sim 봇도 같은 함수를
   부른다. 이 분리가 깨지면 밸런스 기준선을 잴 수 없다.
   ══════════════════════════════════════════════════════════════ */

/* ── 상대 요구 4종 ────────────────────────────────────────── */
const DEMANDS = {
  price: { n: '가격을 더 낮춰 달라',      d: '인수가를 깎으려 든다' },
  job:   { n: '고용을 승계해 달라',        d: '임직원 자리를 보장하라고 한다' },
  data:  { n: '장부를 더 보여 달라',       d: '자료를 요구한다' },
  delay: { n: '다음에 다시 이야기하자',    d: '시간을 끈다' },
};
const DEMAND_KEYS = Object.keys(DEMANDS);

/* ── 우리 접근 3종과 상성 ──────────────────────────────────
   가위바위보 수준으로 얕게 유지한다. 각 접근이 요구 2종에 강하다. */
const APPROACH = {
  persuade: { n: '설득', beats: ['job', 'delay'],   stat: 'nego' },
  evidence: { n: '자료', beats: ['price', 'data'],  stat: 'intel' },
  press:    { n: '압박', beats: ['delay', 'price'], stat: 'nego' },
};

/**
 * 직원 한 명의 접근을 정한다. 플레이어가 고르는 것은 **직원**이고,
 * 접근은 그 직원의 성격에서 나온다 — 선택지가 3개를 넘지 않게 하려는 것.
 */
function approachOf(e) {
  if (e.trait?.id === 'shark') return 'press';        // 승부사는 밀어붙인다
  return (e.intel || 0) > (e.nego || 0) ? 'evidence' : 'persuade';
}

/**
 * **단판이다.** 난이도별로 2~5 라운드를 돌렸더니 완주까지 이 모달만 60~80번
 * 뜬다 — 카이로 문법에서 한 사이클의 결정 수를 넘는다. 라운드를 1로 줄이고
 * 대신 한 수의 무게를 키웠다 (BAL.tableHit/Miss).
 */
const tableRounds = () => 1;

/**
 * 상대 요구를 뽑는다. 쓰는 것은 앞의 1개뿐이지만 **뽑기는 예전과 같은 횟수로
 * 한다** — rand() 소비량이 달라지면 시드 스트림이 밀려 이전 계측과 비교
 * 자체가 불가능해진다 (기획서 §7-1 에서 한 번 밟은 함정).
 */
function rollDemands(diff) {
  const drawn = Array.from({ length: 2 + diff },
                           () => DEMAND_KEYS[Math.floor(rand() * DEMAND_KEYS.length)]);
  return drawn.slice(0, tableRounds());
}

/**
 * 한 라운드 판정. 게이지 둘이 시소로 움직인다 —
 * 성공도를 올리면 인수가가 오른다. 이게 매 라운드의 선택이다.
 *
 * 상성이 맞으면 성공도가 크게 오르고 인수가도 내려간다.
 * 빗나가면 성공도는 조금 오르지만 인수가를 양보하게 된다.
 */
function tableRound(emp, demand) {
  const ap = APPROACH[approachOf(emp)];
  const hit = ap.beats.includes(demand);
  const skill = clamp((emp[ap.stat] || 0) / 20, 0.4, 1.8);   // 스탯 10 → 0.5배, 30 → 1.5배

  const dS = (hit ? BAL.tableHitSuccess : BAL.tableMissSuccess) * skill;
  let dP = hit ? -BAL.tableHitPrem : BAL.tableMissPrem;
  if (emp.trait?.id === 'cheap') dP -= BAL.tableCheapPrem;    // 짠돌이는 값을 안 올린다
  if (emp.trait?.id === 'calm' && !hit) dP *= 0.5;            // 포커페이스는 헛수를 덜 물린다
  return { hit, approach: ap.n, dS, dP };
}

/**
 * 테이블 전체 판정. picks[i] = i 라운드에 낸 팀원 인덱스.
 * 반환은 성공도·프리미엄의 **증감분**이다 — 호출부가 기존 값에 더한다.
 */
function resolveTable(team, demands, picks) {
  let dS = 0, dP = 0; const log = [];
  demands.forEach((dem, i) => {
    const emp = team[picks[i]] || team[0];
    if (!emp) return;
    const r = tableRound(emp, dem);
    dS += r.dS; dP += r.dP;
    log.push({ round: i + 1, demand: dem, emp: emp.name, ...r });
  });
  return { dS, dP, log };
}

/**
 * 최선 수. 직접 협상하는 플레이어가 도달할 수 있는 상한이고, sim 의 `--table`
 * 봇이 쓴다.
 */
function bestPicks(team, demands) {
  return demands.map(dem => {
    let best = 0, bestV = -Infinity;
    team.forEach((e, i) => {
      const r = tableRound(e, dem);
      const v = r.dS - r.dP * 100;        // 성공도 1 ≈ 프리미엄 1%p 로 환산해 비교
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  });
}

/**
 * 위임 결과 — **아무 일도 일어나지 않는다.**
 *
 * 두 번 고쳐서 여기까지 왔다.
 * 1) 위임도 최선 수를 두게 했더니 직접 협상의 상한이 위임과 같아져 직접 할
 *    이유가 사라졌다 (실수하면 손해만 본다).
 * 2) 위임을 무작위 수로 바꿨더니 기대값은 0 인데 **분산**이 생겨 기준선이
 *    830 → 869일로 밀리고 결렬률이 시드별로 23~55% 로 튀었다.
 *
 * 테이블은 기존 밸런스 위에 새로 얹은 판정이다. 맡기면 정확히 0 이어야
 * 기준선이 보존되고, 직접 두는 쪽만 ± 를 진다. 위임은 난수도 쓰지 않는다.
 */
function delegateTable() {
  return { dS: 0, dP: 0, log: [] };
}

export { APPROACH, DEMANDS, DEMAND_KEYS, approachOf, bestPicks, delegateTable };
export { resolveTable, rollDemands, tableRound, tableRounds };
