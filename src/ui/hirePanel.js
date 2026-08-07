import { HIRE_WAYS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, clamp, esc, won } from '../core/util.js';
import { applicants, hireCost, staffCap } from '../systems/company.js';
import { negoInSlot } from '../systems/mna.js';
import { renderHud } from './hud.js';
import { toast } from './toast.js';

/* ══════════════════════════════════════════════════════════════
   신규 고용

   레퍼런스는 게임 개발 스토리의 고용 흐름이다 — **모집 방법을 고르고 →
   지원자를 한 명씩 넘겨 보고 → 자리가 없으면 누구를 내보낼지 고른다.**

   기존 '스카웃 시장' 은 후보 셋이 항상 떠 있고 새로고침만 누르면 되는
   구조라, 돈을 쓰는 판단이 "새로고침 한 번 더" 하나뿐이었다. 모집 방법을
   나누면 **얼마짜리 사람을 찾을지**가 먼저 오는 결정이 된다.

   화면은 셋 중 하나다 (`VIEW`).
   · ways  — 모집 방법 고르기
   · list  — 이번에 온 지원자들
   · fire  — 정원이 찼을 때 누구를 내보낼지
   ══════════════════════════════════════════════════════════════ */

let VIEW = 'ways';
let POOL = [];            // 이번 모집으로 온 지원자
let WAY = null;           // 어떤 방법으로 뽑았는지
let PENDING = null;       // 정원이 차서 대기 중인 합격자

/** 능력치 막대 — 숫자만 늘어놓으면 비교가 안 된다 */
function stats(e, ref) {
  const KEYS = [['nego', '협상'], ['intel', '정보'], ['sales', '영업'], ['fin', '재무']];
  return KEYS.map(([k, n]) => {
    const v = e[k], hi = ref && v > ref[k], lo = ref && v < ref[k];
    return `<div class="kv"><span>${n}</span>
      <b class="${hi ? 'c-jade' : lo ? 'c-blood' : ''}">${v}${ref ? (hi ? ' ▲' : lo ? ' ▼' : ' =') : ''}</b></div>`;
  }).join('');
}

const power = e => e.nego + e.intel + e.sales + e.fin;

function viewWays(s) {
  const cap = staffCap(s), full = s.staff.length >= cap;
  return `<div class="row">
      <h4>사원 정원<b class="${full ? 'c-blood' : 'c-jade'}">${s.staff.length} / ${cap}</b></h4>
      <div class="meta">${full
        ? '자리가 없습니다. 새로 뽑으려면 누군가를 내보내야 합니다.'
        : '등급이 오르거나 사무실을 넓히면 자리가 늘어납니다.'}</div>
    </div>
    <div class="row"><h4>어떻게 찾으시겠습니까</h4>
      <div class="meta">비싼 방법일수록 좋은 사람이, 더 많이 옵니다.</div></div>
    ${HIRE_WAYS.map(w => {
      const c = hireCost(s, w);
      return `<div class="row tight">
        <h4>${w.n}<b class="c-gold">${won(c)}</b></h4>
        <div class="meta">${w.d} · 지원자 ${w.pick}명</div>
        <div class="btn-row">
          <button class="btn gold" data-way="${w.id}" ${s.co.cash < c ? 'disabled' : ''}>모집</button>
        </div></div>`;
    }).join('')}`;
}

function viewList(s) {
  if (!POOL.length) {
    return `<div class="row"><h4>${WAY.n}</h4>
      <div class="meta">더 볼 지원자가 없습니다.</div></div>
      <button class="btn wide" data-back="1">모집 방법으로</button>`;
  }
  return `<div class="row"><h4>${WAY.n}<b class="c-dim">지원자 ${POOL.length}명</b></h4>
      <div class="meta">계약금은 월급의 3개월치입니다.</div></div>
    ${POOL.map((e, i) => `<div class="row tight">
      <h4>${esc(e.name)} <span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${e.grade}급 · 종합 ${power(e)}</span>
        <b class="c-gold">월 ${won(e.salary)}</b></h4>
      ${stats(e)}
      <div class="meta">${e.trait.name} — ${e.trait.desc}</div>
      <div class="btn-row">
        <button class="btn gold" data-hire="${i}" ${s.co.cash < e.salary * 3 ? 'disabled' : ''}>고용 (계약금 ${won(e.salary * 3)})</button>
      </div></div>`).join('')}
    <button class="btn wide" data-back="1" style="margin-top:4px">모집 방법으로</button>`;
}

/* 정원이 찼을 때. **합격자와 나란히 놓고** 고르게 한다 — 숫자를 외워서
   다른 화면으로 옮겨 가 비교하게 만들면 그건 판단이 아니라 암기다. */
function viewFire(s) {
  return `<div class="row" style="border-color:var(--gold)">
      <h4>자리가 없습니다</h4>
      <div class="meta"><b>${esc(PENDING.name)}</b>(${PENDING.grade}급 · 종합 ${power(PENDING)})을(를) 들이려면
        한 명을 내보내야 합니다. 아래는 그 사람과의 비교입니다.</div>
    </div>
    ${s.staff.map(e => `<div class="row tight">
      <h4>${esc(e.name)} <span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">Lv.${e.lv} · 종합 ${power(e)}</span></h4>
      ${stats(PENDING, e)}
      <div class="meta">${e.onTeam ? '협상단' : e.atShop ? '매장 근무' : '계열사 관리'} · 월 ${won(e.salary)}
        ${negoInSlot(s, e) ? '<b class="c-blood"> · 협상 중이라 내보낼 수 없습니다</b>' : ''}</div>
      <div class="btn-row">
        <button class="btn blood" data-swap="${e.id}" ${negoInSlot(s, e) ? 'disabled' : ''}>내보내고 들이기</button>
      </div></div>`).join('')}
    <button class="btn wide" data-cancel="1" style="margin-top:4px">이번엔 그만둔다</button>`;
}

function renderHire() {
  const s = S;
  if (VIEW === 'fire' && !PENDING) VIEW = 'ways';
  $('panel-body').innerHTML =
    VIEW === 'list' ? viewList(s) : VIEW === 'fire' ? viewFire(s) : viewWays(s);
  const R = $('panel-body');

  R.querySelectorAll('[data-way]').forEach(b => b.onclick = () => {
    const w = HIRE_WAYS.find(x => x.id === b.dataset.way), c = hireCost(s, w);
    if (s.co.cash < c) return toast('비용이 부족합니다', 'bad');
    s.co.cash -= c;
    WAY = w; POOL = applicants(s, w); VIEW = 'list';
    toast(`${w.n} — 지원자 ${POOL.length}명`, 'good');
    renderHire(); renderHud();
  });

  R.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => {
    const e = POOL[+b.dataset.hire], fee = e.salary * 3;
    if (s.co.cash < fee) return toast('계약금이 부족합니다', 'bad');
    /* 정원이 차 있으면 **계약금을 먼저 받지 않는다.** 내보낼 사람을 못 고르고
       빠져나가면 돈만 사라진 꼴이 된다. */
    if (s.staff.length >= staffCap(s)) { PENDING = e; VIEW = 'fire'; return renderHire(); }
    s.co.cash -= fee; POOL.splice(+b.dataset.hire, 1); s.staff.push(e);
    toast(`${e.name} 입사`, 'good'); renderHire(); renderHud();
  });

  R.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => {
    const i = s.staff.findIndex(x => x.id === b.dataset.swap), out = s.staff[i];
    if (negoInSlot(s, out)) return toast('협상 중인 인원은 내보낼 수 없습니다', 'bad');
    const fee = PENDING.salary * 3;
    if (s.co.cash < fee) return toast('계약금이 부족합니다', 'bad');
    s.co.cash -= fee;
    s.staff.splice(i, 1);
    s.staff.push(PENDING);
    POOL = POOL.filter(x => x.id !== PENDING.id);
    toast(`${out.name} 퇴사 · ${PENDING.name} 입사`, 'good');
    PENDING = null; VIEW = 'list';
    renderHire(); renderHud();
  });

  R.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => {
    PENDING = null; VIEW = 'list'; renderHire();
  });
  R.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
    VIEW = 'ways'; renderHire();
  });
}

/** 탭을 새로 열 때는 항상 모집 방법부터 */
function resetHire() { VIEW = 'ways'; POOL = []; PENDING = null; }

export { renderHire, resetHire };
