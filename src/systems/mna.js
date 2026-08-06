import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { DIFFS, SECTORS } from '../core/data.js';
import { sumStat, teamOf } from '../core/derive.js';
import { bumpPerks, divisionName, divisionsOf, subPriceMul, tagsOf } from '../core/tags.js';
import { rand } from '../core/rng.js';
import { $, chance, clamp, pct, pick, rint, rnd, won } from '../core/util.js';
import { capCeiling, checkTier, loanRate, recalcCap, teamPower } from './company.js';
import { delegateTable, rollDemands } from './negoTable.js';
import { clearStake, stakeBonus } from './stock.js';
import { onAcquired } from './subs.js';
import { openAcqLoan } from '../ui/bankPanel.js';
import { openModal } from '../ui/modal.js';
import { openTable } from '../ui/negoTable.js';
import { news, pushInbox, toast } from '../ui/toast.js';

function startNego(s, target, direct = false) {
  const team = teamOf(s);
  if (!team.length) return toast('협상단에 배정된 직원이 없습니다', 'bad');
  if (s.nego) return toast('이미 진행 중인 협상이 있습니다', 'bad');
  if (target.cap > capCeiling(s)) return toast('회사 등급이 낮아 이 규모는 인수할 수 없습니다', 'bad');

  const d = DIFFS[target.diff];
  let prem = d.prem;
  prem -= sumStat(team, 'intel') * 0.0016;
  prem -= team.filter(e => e.trait.id === 'cheap').length * 0.06;
  const r = s.rumors.find(x => x.target === target.id && x.used);
  if (r) prem -= r.val;
  // 알짜는 비싸고 부실은 싸다. 프리미엄이 아니라 배수라 여기서 따로 들고 간다
  const tagMul = subPriceMul(target);
  /* 미리 사두기 — 밑작업이 협상 시작값에 얹힌다. 여기가 주식과 M&A 를 잇는 유일한
     지점이다. 소문이 난 뒤(c.leak)에는 프리미엄이 도로 올라간다. */
  const stake = stakeBonus(s, target);
  prem += stake.prem;

  s.nego = {
    id: target.id, name: target.name, diff: target.diff,
    progress: 0, success: 12 + sumStat(team, 'nego') * 0.08 + stake.success,
    prem: Math.max(0.02, prem), tagMul, team: team.map(e => e.id),
    marks: [25, 50, 75], blessed: 0,
    acts: BAL.negoActs, done: [],   // 능동 개입 잔여 횟수와 이력
    direct,                          // 클로징에서 테이블을 열지 (false = 협상단에 위임)
  };
  /* 매물 경쟁 — 마감이 걸리면 진행 속도가 자원이 된다 */
  if (chance(BAL.rivalChance)) {
    s.nego.rivalDue = s.day + rint(BAL.rivalDaysMin, BAL.rivalDaysMax);
    news(`${target.name}에 다른 그룹도 접근 중`);
    pushInbox(s, '경쟁 인수자 등장',
      `<b>${target.name}</b> 인수에 다른 그룹이 뛰어들었습니다. <b>${s.nego.rivalDue - s.day}일</b> 안에 협상을 마치지 못하면 넘어갑니다. 회사 창에서 <b>시한 제시</b>로 진행을 앞당길 수 있습니다.`, 'bad');
  }
  news(`${s.co.name} 협상단, ${target.name} 인수 협상 착수`);
  if (stake.stars) toast(`사둔 지분 ${'★'.repeat(stake.stars)} — 성공도 +${stake.success}`, 'good');
  toast(`${target.name} 협상 시작 — 협상 중에도 경영은 계속됩니다`);
}

function tickNego(s) {
  const n = s.nego; if (!n) return;
  const tgt = s.market.find(c => c.id === n.id);
  const team = s.staff.filter(e => n.team.includes(e.id));

  n.progress = Math.min(100, n.progress + BAL.negoProgressPerDay * rnd(0.9, 1.1));

  let gain = BAL.negoSuccessBase * DIFFS[n.diff].mul * (0.35 + teamPower(s) * 0.012);
  if (tgt?.curse > 0) gain *= 1.45;                                  // 살굿 적중
  if (s.co.mistrust > BAL.mistrustPenaltyAt) gain *= 0.78;           // 미신지수 페널티
  n.success = clamp(n.success + gain, 0, 100);

  // 협상 중 분기 이벤트
  if (n.marks.length && n.progress >= n.marks[0]) {
    n.marks.shift();
    negoEvent(s, n, team);
  }
  // 마감을 넘기면 매물이 넘어간다. 진행도 판정보다 **먼저** 본다
  if (n.rivalDue && s.day >= n.rivalDue && n.progress < 100) return loseToRival(s);
  if (n.progress >= 100) finishNego(s);
}

/**
 * 경쟁에서 밀렸다. 매물을 시장에서 빼지 않는다 — 후반에 살 것이 마른다.
 * 값이 오르고 난이도가 올라 '더 비싸게라도 다시 노릴지'가 선택으로 남는다.
 */
function loseToRival(s) {
  const n = s.nego, tgt = s.market.find(c => c.id === n.id);
  s.nego = null;
  if (tgt) {
    tgt.cap = Math.round(tgt.cap * (1 + BAL.rivalCapUp));
    tgt.diff = Math.min(3, tgt.diff + 1);
    tgt.rivalOwned = true;
    news(`${tgt.name}, 다른 그룹에 넘어감`);
    pushInbox(s, '인수 실패 — 경쟁에서 밀림',
      `<b>${tgt.name}</b>이(가) 다른 그룹에 넘어갔습니다. 시가총액이 ${Math.round(BAL.rivalCapUp * 100)}% 오르고 인수 난이도가 한 단계 올라갔습니다. 다시 노릴 수는 있습니다.`, 'bad');
    toast(`${tgt.name} — 경쟁에서 밀렸습니다`, 'bad');
  }
}

/* ══════════════════════════════════════════════════════════════
   협상 중 능동 개입 — 협상 1건에 3회

   협상 15일이 '지켜보기'뿐이라 두 가지가 따라왔다. 결렬이 **전손**이었고
   (15일과 협상단 기회비용이 통째로 증발), 3억짜리와 1조짜리 인수의 절차가
   완전히 같았다. 개입을 넣으면 그 15일이 판단 구간이 된다.

   sim 계측상 중소기업 구간(전체의 34%)은 놀고 있는 날이 1~14% 뿐이고
   나머지는 전부 협상 중이다 — **협상 슬롯이 진짜 병목이다.**
   `push`(시한 제시)와 `quit`(중단)이 그 슬롯을 성공 확률과 맞바꾼다.

   판정은 전부 여기 있는 순수 함수다. UI 는 negoAct 를 부르는 껍데기이고
   sim 봇도 같은 함수를 부른다 — 이 분리가 깨지면 밸런스 기준선이 무효가 된다.

   '협상단 교체'는 넣지 않았다. 성공도 증가율은 이미 teamOf(s) 를 매일 읽으므로
   직원 창에서 편성을 바꾸면 그 즉시 반영된다. 교체 버튼은 진행도만 깎는
   순손실 버튼이 된다.
   ══════════════════════════════════════════════════════════════ */

/** 개입 비용. 시총 비례로만 잡으면 후반에 즉사한다 — 보유 자금 상한을 같이 둔다
    (HANDOFF §8 '세무조사로 즉사'와 같은 함정). */
const negoBill = (s, r) => Math.round(Math.min(s.co.cap * r, Math.max(1e6, s.co.cash * 0.20)));

/** 지금 조건으로 계산한 예상 인수가 */
function estPrice(s, n) {
  const t = s.market.find(c => c.id === n.id);
  return t ? Math.round(t.cap * (1 + n.prem) * (n.tagMul ?? 1)) : 0;
}

/** 남은 개입 횟수. 구버전 세이브의 진행 중 협상에는 acts 가 없다 */
const negoLeft = n => n.acts ?? BAL.negoActs;

const NEGO_ACTS = {
  wine: {
    n: '접대비 집행', d: '성공도 +12 · 수사 압박 +5',
    cost: s => negoBill(s, BAL.negoWineCost),
    can: (s) => s.co.cash < negoBill(s, BAL.negoWineCost) ? '자금이 부족합니다' : null,
    run: (s, n) => {
      n.success = clamp(n.success + BAL.negoWineSuccess, 0, 100);
      s.co.probe += BAL.negoWineProbe;
      toast(`성공도 +${BAL.negoWineSuccess} · 수사 압박 +${BAL.negoWineProbe}`, 'good');
    },
  },
  push: {
    n: '시한 제시', d: '진행도 +30 · 성공도 -8',
    cost: () => 0,
    can: (s, n) => n.progress >= 100 ? '이미 마무리 단계입니다' : null,
    run: (s, n) => {
      n.progress = Math.min(100, n.progress + BAL.negoPushProgress);
      n.success = clamp(n.success + BAL.negoPushSuccess, 0, 100);
      toast(`협상을 앞당겼습니다 — 성공도 ${BAL.negoPushSuccess}`, 'bad');
    },
  },
  /* 실사(숨은 특성 공개)는 개입에서 뺐다. 협상 1건에 4종 × 3회는 카이로 문법에
     비해 조작이 너무 잦고, 정보 공개는 **밑작업 ★★** 로 옮겼다 (stock.js:revealAt).
     매집에 정보 가치가 붙어 그 기능이 두터워지고 조작은 하나도 늘지 않는다. */
  quit: {
    free: true,        // 개입 횟수를 먹지 않는다. 손절은 개입이 아니라 탈출구다
    n: '협상 중단', d: '즉시 종료 · 위약금 = 예상 인수가의 3%',
    cost: (s, n) => Math.round(estPrice(s, n) * BAL.negoQuitFee),
    can: (s, n) => s.co.cash < Math.round(estPrice(s, n) * BAL.negoQuitFee) ? '위약금을 낼 자금이 없습니다' : null,
    run: (s, n) => {
      news(`${n.name} 인수 협상 중단`);
      toast(`${n.name} 협상 중단 — 협상단이 복귀했습니다`);
      s.nego = null;
    },
  },
};

/**
 * 개입 1회를 실행한다. 성공하면 true.
 * 횟수 차감 → 비용 지불 → 효과 순서다. 효과 안에서 s.nego 를 지우는 것(quit)이
 * 있으므로 차감과 이력은 반드시 먼저 해 둔다.
 */
function negoAct(s, id) {
  const n = s.nego, act = NEGO_ACTS[id];
  if (!n || !act) return false;
  if (!act.free && negoLeft(n) <= 0) { toast('이번 협상에서 쓸 수 있는 개입을 모두 썼습니다', 'bad'); return false; }
  const why = act.can(s, n);
  if (why) { toast(why, 'bad'); return false; }

  const cost = act.cost(s, n);
  if (!act.free) n.acts = negoLeft(n) - 1;
  n.done = [...(n.done || []), id];
  s.co.cash -= cost;
  act.run(s, n);
  return true;
}

function negoEvent(s, n, team) {
  const calm = team.some(e => e.trait.id === 'calm');
  const pool = [
    { t:'상대측 실사 요구', d:`${n.name} 측이 자산 실사를 요구합니다.`,
      c:[{ l:'전면 공개', s:+9, m:0, note:'신뢰 확보, 성공도 +9' },
         { l:'일부만 공개', s:-4, m:-0.05, note:'인수가 -5%p, 성공도 -4' }] },
    { t:'노조 반발', d:`${n.name} 노조가 고용 승계를 요구하며 반발합니다.`,
      c:[{ l:'고용 승계 약속', s:+11, m:+0.07, note:'인수가 +7%p, 성공도 +11' },
         { l:'구조조정 명시', s:-13, m:-0.10, note:'인수가 -10%p, 성공도 -13' }] },
    { t:'경쟁 인수자 등장', d:'다른 그룹이 같은 매물에 관심을 보입니다.',
      c:[{ l:'가격 인상 제시', s:+14, m:+0.14, note:'인수가 +14%p, 성공도 +14' },
         { l:'조건 유지', s:-9, m:0, note:'성공도 -9' }] },
    { t:'창업주 감정', d:'창업주가 회사 매각 자체를 망설이고 있습니다.',
      c:[{ l:'명예회장직 제안', s:+13, m:+0.05, note:'인수가 +5%p, 성공도 +13' },
         { l:'현금 일시불 압박', s:-6, m:-0.08, note:'인수가 -8%p, 성공도 -6' }] },
    { t:'숨은 빚 발견', d:`${n.name} 장부에서 누락된 채무가 확인됐습니다.`,
      c:[{ l:'가격 재협상', s:-5, m:-0.16, note:'인수가 -16%p, 성공도 -5' },
         { l:'모른 척 진행', s:+6, m:0, note:'성공도 +6 (인수 후 부채 승계)' }] },
  ];
  const ev = pick(pool);
  pause();
  openModal({
    title: `협상 이벤트 — ${ev.t}`,
    body: `<p>${ev.d}</p><div class="kv" style="margin-top:10px"><span>진행도</span><b>${pct(n.progress)}</b></div><div class="kv"><span>성공도</span><b>${pct(n.success)}</b></div>`,
    choices: ev.c.map(c => ({
      label: c.l, sub: c.note + (calm && c.s < 0 ? ' · 포커페이스로 완화' : ''),
      run: () => {
        let d = c.s; if (calm && d < 0) d *= 0.55;
        n.success = clamp(n.success + d, 0, 100);
        n.prem = Math.max(0.02, n.prem + c.m);
        toast(`성공도 ${d >= 0 ? '+' : ''}${Math.round(d)}`, d >= 0 ? 'good' : 'bad');
        resume();
      },
    })),
  });
}

/**
 * 클로징. 진행도 100% 에서 불린다.
 *
 * 테이블을 **먼저** 치르고 그 결과를 성공도·프리미엄에 얹은 뒤 판정한다.
 * 위임이면 같은 판을 봇 정책으로 즉시 계산한다 — 직접 하는 쪽이 늘 유리해지지
 * 않도록 위임도 최선 수를 둔다.
 */
function finishNego(s) {
  const n = s.nego, tgt = s.market.find(c => c.id === n.id);
  const team = s.staff.filter(e => n.team.includes(e.id));

  if (n.direct && team.length) {
    /* 요구 카드는 **직접 협상할 때만** 뽑는다. 위임 경로에서 뽑으면 난수열이
       밀려 같은 시드가 다른 판이 된다 — 단계 1 의 태그 추첨과 같은 함정이다. */
    pause();
    return openTable(s, n, tgt, team, rollDemands(n.diff));
  }
  applyTable(n, delegateTable());
  judgeNego(s);
}

/** 테이블 결과를 협상 상태에 얹는다. 판정 직전의 마지막 보정이다 */
function applyTable(n, r) {
  n.success = clamp(n.success + r.dS, 0, 100);
  n.prem = Math.max(0.02, n.prem + r.dP);
  n.tableLog = r.log;
}

/** 성공도로 성사/결렬을 판정하고 인수가 모달까지 띄운다 */
function judgeNego(s) {
  const n = s.nego, tgt = s.market.find(c => c.id === n.id);
  s.nego = null;
  const roll = rand() * 100 < n.success;
  if (!roll) {
    news(`${tgt.name} 인수 협상 결렬`);
    pause();
    return openModal({
      title: '협상 결렬',
      body: `<p><b>${tgt.name}</b> 인수 협상이 최종 결렬됐습니다.</p>
             <div class="kv" style="margin-top:10px"><span>최종 성공도</span><b>${pct(n.success)}</b></div>
             <p style="margin-top:10px;font-size:12px" class="c-dim">협상단 능력, 대상 난이도, 이벤트 선택이 성공도를 결정합니다. 살굿이나 찌라시로 난이도를 낮춰볼 수 있습니다.</p>`,
      actions: [{ label: '확인', run: resume }],
    });
  }
  const price = Math.round(tgt.cap * (1 + n.prem) * (n.tagMul ?? 1));
  const short = Math.max(0, price - s.co.cash);
  pause();
  openModal({
    title: '협상 성사 — 인수가 확정',
    body: `<p><b>${tgt.name}</b> 인수 협상이 성사됐습니다. 인수가를 지불하면 인수가 완료됩니다.</p>
      <div class="kv" style="margin-top:10px"><span>대상 시가총액</span><b>${won(tgt.cap)}</b></div>
      <div class="kv"><span>경영권 웃돈</span><b>+${(n.prem * 100).toFixed(0)}%</b></div>
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:6px;padding-top:6px"><span>최종 인수가</span><b class="c-gold">${won(price)}</b></div>
      <div class="kv"><span>보유 자금</span><b class="${short ? 'c-blood' : 'c-jade'}">${won(s.co.cash)}</b></div>`,
    choices: [
      { label: `자기자금으로 지불 — ${won(price)}`, dis: short > 0,
        sub: short ? `자금 ${won(short)} 부족` : '부채 없이 인수 완료',
        run: () => { s.co.cash -= price; completeAcq(s, tgt, price); resume(); } },
      { label: '인수 대출로 충당', dis: short === 0,
        sub: short ? `부족액 ${won(short)} · 금리 ${loanRate(s, 'acq').toFixed(1)}% · 인수 기업 담보` : '자기자금으로 충분합니다',
        run: () => { resume(); openAcqLoan(tgt, price); } },
      { label: '인수 포기', sub: '협상 결과를 파기합니다',
        run: () => { news(`${tgt.name} 인수 무산 — 자금 미납`); resume(); } },
    ],
  });
}

function completeAcq(s, tgt, price) {
  tgt.owned = true;
  const sub = {
    id: tgt.id, name: tgt.name, sector: tgt.sector, cap: tgt.cap, diff: tgt.diff, day: s.day,
    tags: tagsOf(tgt).slice(),   // 특성은 그대로 따라온다
    seen: (tgt.seen || []).slice(),
    paid: price,                 // 매각 손익을 보여주려면 인수가를 기억해야 한다
    restruct: null, debtDay: 0,
  };
  s.co.subs.push(sub);
  onAcquired(s, sub, tgt);       // 우발채무 예약 · 자회사 편입 · 해외 변동 초기화
  if ((tgt.diff0 ?? tgt.diff) >= 2) s.co.hardAcq++;
  s.rumors = s.rumors.filter(r => r.target !== tgt.id);
  clearStake(s, tgt.id);         // 사둔 지분은 인수에 흡수된다
  news(`${s.co.name}, ${tgt.name} 인수 완료 (${won(price)})`);
  toast(`${tgt.name} 인수 완료 — ${SECTORS[tgt.sector].name} 상품군 추가`, 'good');
  pushInbox(s, '인수 완료', `${tgt.name}을(를) ${won(price)}에 인수했습니다. 통합에 ${BAL.pmiDays}일이 걸리며, 그동안은 관리비만 나가고 수익은 서서히 올라옵니다.`, 'good');
  bumpPerks();
  checkDivisions(s);
  recalcCap(s); checkTier(s);
}

/* 사업부 결성/해체를 **상태 변화가 있을 때만** 알린다.
   매일 돌리면 압류·매각으로 해체됐다 재결성될 때 연출이 반복된다. */
function checkDivisions(s) {
  const now = divisionsOf(s);
  const was = s.co.divs || [];
  const born = now.filter(k => !was.includes(k));
  s.co.divs = now;
  if (!born.length) return;

  born.forEach(k => {
    news(`${s.co.name}, ${divisionName(k)} 출범`);
    pushInbox(s, '사업부 출범',
      `같은 업종 계열사가 3개가 되어 <b>${divisionName(k)}</b>가 결성됐습니다. 해당 업종 효과가 <b>2배</b>가 됩니다.`, 'good');
  });
  if (now.length >= 5 && was.length < 5) {
    news(`${s.co.name}, 그룹 본사 출범`);
    toast('그룹 본사 — 관리 인력 요구 -25%', 'good');
  }
}

export { applyTable, checkDivisions, completeAcq, finishNego, judgeNego, loseToRival, negoEvent, startNego, tickNego };
export { NEGO_ACTS, negoAct, negoLeft };
