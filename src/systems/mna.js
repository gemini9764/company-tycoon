import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { DIFFS, SECTORS } from '../core/data.js';
import { sumStat, teamOf } from '../core/derive.js';
import { bumpPerks, divisionName, divisionsOf, subPriceMul, tagsOf } from '../core/tags.js';
import { rand } from '../core/rng.js';
import { $, clamp, pct, pick, rnd, won } from '../core/util.js';
import { capCeiling, checkTier, loanRate, recalcCap, teamPower } from './company.js';
import { onAcquired } from './subs.js';
import { openAcqLoan } from '../ui/bankPanel.js';
import { openModal } from '../ui/modal.js';
import { news, pushInbox, toast } from '../ui/toast.js';

function startNego(s, target) {
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

  s.nego = {
    id: target.id, name: target.name, diff: target.diff,
    progress: 0, success: 12 + sumStat(team, 'nego') * 0.08,
    prem: Math.max(0.02, prem), tagMul, team: team.map(e => e.id),
    marks: [25, 50, 75], blessed: 0,
  };
  news(`${s.co.name} 협상단, ${target.name} 인수 협상 착수`);
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
  if (n.progress >= 100) finishNego(s);
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
    { t:'우발채무 발견', d:`${n.name} 장부에서 누락된 채무가 확인됐습니다.`,
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

function finishNego(s) {
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
      <div class="kv"><span>경영권 프리미엄</span><b>+${(n.prem * 100).toFixed(0)}%</b></div>
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:6px;padding-top:6px"><span>최종 인수가</span><b class="c-gold">${won(price)}</b></div>
      <div class="kv"><span>보유 자금</span><b class="${short ? 'c-blood' : 'c-jade'}">${won(s.co.cash)}</b></div>`,
    choices: [
      { label: `자기자금으로 지불 — ${won(price)}`, dis: short > 0,
        sub: short ? `자금 ${won(short)} 부족` : '부채 없이 인수 완료',
        run: () => { s.co.cash -= price; completeAcq(s, tgt, price); resume(); } },
      { label: '인수금융 대출로 충당', dis: short === 0,
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
    news(`${s.co.name}, 지주회사 체제 전환`);
    toast('지주회사 체제 — 관리 인력 요구 -25%', 'good');
  }
}

export { checkDivisions, completeAcq, finishNego, negoEvent, startNego, tickNego };
