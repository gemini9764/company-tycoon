import { clearPause } from '../core/clock.js';
import { BAL } from '../core/balance.js';
import { TIERS } from '../core/data.js';
import { SAVE_KEY, Store } from '../core/storage.js';
import { $, won } from '../core/util.js';
import { openModal } from '../ui/modal.js';
import { news, toast } from '../ui/toast.js';

/* ══════════════════════════════════════════════════════════════
   ENDING — 실패만 끝난다

   성공에는 종점이 없다. 글로벌그룹에 오르고 시총 1위를 찍어도 게임은 계속되고,
   그다음부터는 시가총액 자체가 목표가 된다. 그래서 '엔딩'은 파산·수사·무속
   세 가지 실패뿐이고, 성공은 전부 **마일스톤**으로 처리한다.
   ══════════════════════════════════════════════════════════════ */

function checkEnding(s) {
  if (s.flags.ending) return;
  if (s.co.probe >= BAL.probeDeath) return endGame(s, 'probe');
  if (s.co.mistrust >= BAL.mistrustDeath) return endGame(s, 'occult');
  checkMilestone(s);
}

/* ── 마일스톤 ────────────────────────────────────────────────
   순위는 1위가 천장이라 거기서 목표가 사라진다. 1위를 찍은 뒤에는
   시가총액 단계로 넘어가고, 그 단계는 무한히 이어진다. */
const MILESTONES = [
  { id:'tier6',   ok:s=>s.co.tier === TIERS.length - 1, t:'글로벌그룹 등극',
    d:'최고 등급에 올랐습니다. 이제 목표는 등급이 아니라 <b>시가총액 순위</b>입니다.' },
  { id:'rank50',  ok:s=>s.co.rank <= 50,  t:'시총 50위 진입',  d:'상위권에 이름을 올렸습니다.' },
  { id:'rank10',  ok:s=>s.co.rank <= 10,  t:'시총 10위 진입',  d:'재계 서열이 뒤집히고 있습니다.' },
  { id:'rank3',   ok:s=>s.co.rank <= 3,   t:'시총 3위 진입',   d:'1위가 눈앞입니다.' },
  { id:'rank1',   ok:s=>s.co.rank <= 1,   t:'시가총액 1위',
    d:'업계 1위에 올랐습니다. 이제부터는 <b>시가총액 그 자체</b>가 기록입니다.' },
];

/* 1위 이후의 시총 단계. 앞은 손으로 잡고 그 뒤는 3배씩 무한히 늘린다. */
const CAP_STEPS = [5e13, 1e14, 3e14, 1e15, 3e15, 1e16];

function capGoal(n) {
  return n < CAP_STEPS.length ? CAP_STEPS[n]
    : CAP_STEPS[CAP_STEPS.length - 1] * Math.pow(3, n - CAP_STEPS.length + 1);
}

/** 화면에 보여 줄 다음 목표 한 줄. */
function goalText(s) {
  if (s.co.tier < TIERS.length - 1) return TIERS[s.co.tier].goal;
  const m = MILESTONES.find(x => !s.flags.ms.includes(x.id));
  if (m) return m.t;
  return `시가총액 ${won(capGoal(s.flags.capGoal))} 돌파`;
}

function checkMilestone(s) {
  for (const m of MILESTONES) {
    if (s.flags.ms.includes(m.id) || !m.ok(s)) continue;
    s.flags.ms.push(m.id);
    return announce(s, m.t, m.d);
  }
  // 순위 단계를 다 지났으면 시총 단계로 넘어간다 — 여기서부터는 끝이 없다
  if (!s.flags.ms.includes('rank1')) return;
  const goal = capGoal(s.flags.capGoal);
  if (s.co.cap >= goal) {
    s.flags.capGoal++;
    announce(s, `시가총액 ${won(goal)} 돌파`,
      `다음 목표는 ${won(capGoal(s.flags.capGoal))}입니다.`);
  }
}

/* 마일스톤은 게임을 멈추지 않는다. 배속을 유지한 채 알림만 띄운다 —
   여기서 일시정지를 걸면 무한 진행의 흐름이 매번 끊긴다. */
function announce(s, title, desc) {
  news(`${s.co.name}, ${title}`);
  toast(title, 'good');
  openModal({
    title: '기록 달성',
    body: `<div style="text-align:center;padding:8px 0">
      <div style="font-size:20px" class="c-gold">${title}</div>
      <p style="margin:12px 0;font-size:12px;line-height:1.9">${desc}</p>
      <div style="border-top:2px solid var(--paper-3);padding-top:10px;text-align:left">
        <div class="kv"><span>경과</span><b>${s.day}일</b></div>
        <div class="kv"><span>시가총액</span><b>${won(s.co.cap)} · ${s.co.rank}위</b></div>
        <div class="kv"><span>계열사</span><b>${s.co.subs.length}개</b></div>
      </div></div>`,
    actions: [{ label: '계속', cls: 'gold' }],
  });
}

/* ── 엔딩 (실패만) ───────────────────────────────────────── */
const ENDINGS = {
  bankrupt:{ t:'파산', c:'c-blood', d:'연체가 누적되어 자산이 압류됐습니다. 무리한 확장이 그룹을 무너뜨렸습니다.' },
  probe:  { t:'그룹 해체', c:'c-blood', d:'검찰이 정경유착 수사에 착수했고 그룹은 해체 수순을 밟습니다. 로비에 기댄 대가입니다.' },
  occult: { t:'무속 스캔들', c:'c-mauve', d:'미신 경영이 전면 폭로됐습니다. 시장의 신뢰를 잃은 그룹은 사라졌습니다.' },
};

function endGame(s, key) {
  s.flags.ending = key; s.speed = 0; clearPause();
  const e = ENDINGS[key];
  openModal({
    title: '게임 종료', dismissable: false,
    body: `<div style="text-align:center;padding:10px 0">
      <div style="font-size:24px" class="${e.c}">${e.t}</div>
      <p style="margin:14px 0;font-size:12px;line-height:1.9">${e.d}</p>
      <div style="border-top:2px solid var(--paper-3);padding-top:10px;text-align:left">
        <div class="kv"><span>경과</span><b>${s.day}일</b></div>
        <div class="kv"><span>최종 등급</span><b>${TIERS[s.co.tier].name}</b></div>
        <div class="kv"><span>시가총액</span><b>${won(s.co.cap)} · ${s.co.rank}위</b></div>
        <div class="kv"><span>계열사</span><b>${s.co.subs.length}개</b></div>
        <div class="kv"><span>미신지수 / 수사</span><b>${Math.round(s.co.mistrust)} / ${Math.round(s.co.probe)}</b></div>
      </div></div>`,
    actions: [{ label: '새 게임', cls: 'gold', run: () => { Store.del(SAVE_KEY); location.reload(); } }],
  });
}

export { CAP_STEPS, ENDINGS, MILESTONES, announce, capGoal, checkEnding, checkMilestone, endGame, goalText };
