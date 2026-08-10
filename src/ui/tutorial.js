import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { TIERS } from '../core/data.js';
import { teamOf } from '../core/derive.js';
import { S } from '../core/state.js';
import { $, won } from '../core/util.js';
import { capCeiling } from '../systems/company.js';
import { modalStack, openModal } from './modal.js';
import { toast } from './toast.js';

/* ══════════════════════════════════════════════════════════════
   TUTORIAL — 구멍가게 ~ 동네슈퍼 구간 (창업 → 첫 M&A)

   **왜 이 구간인가.** 기획서 4-1 표가 구멍가게에 "경영·주식·M&A 기초 지식
   습득"을 걸어 두었는데, 구현에서는 그 목표가 구멍가게(순자산 3,000만)와
   동네슈퍼(순자산 1억 + 첫 M&A) 둘로 갈렸다. 구멍가게 구간만 잡으면 8~10일
   짜리라 M&A 를 한 번도 못 가르치고 끝난다 (`sim.mjs --runs=0`). 그래서
   튜토리얼은 **두 등급에 걸쳐** 돌고 첫 인수 완료에서 끝난다.

   **비강제다.** 조작을 막지 않고, 순서를 강요하지 않으며, 언제든 건너뛸 수
   있다. 강제 유도를 넣으면 이 장르의 초반 자유도(뭘 먼저 볼지 고르는 재미)가
   통째로 죽는다. 대신 세 가지로 길을 낸다 —
     · 체크리스트  — 맵 좌하단에 상시. 지금 할 일 하나가 굵게 뜬다
     · 하이라이트  — `body[data-tut]` 로 눌러야 할 버튼이 깜빡인다.
                     독은 매 틱 innerHTML 이 새로 그려지므로 **클래스를 직접
                     붙이면 다음 틱에 날아간다.** body 속성 + CSS 선택자면
                     재렌더와 무관하게 유지된다
     · 팝업        — 단계가 열릴 때 한 번. 왜 하는지와 수치를 같이 준다

   **판정은 상태만 본다.** 창을 열었는지 같은 UI 흔적이 아니라 실제로 값이
   바뀌었는지를 본다 (재고 발주만 예외 — 발주 직후와 자연 회복을 상태만으로는
   못 가른다. `tutDid('order')` 훅 하나를 shopPanel 이 부른다).

   **루프 연결은 `frameLoop` 한 곳이다** (`core/loop.js`). `tickDay` 가 아니다 —
   sim·smoke 는 `tickDay()` 를 직접 부르므로 밸런스 기준선이 튜토리얼의 영향을
   전혀 받지 않는다. 덤으로 조작 반응이 하루(15초)가 아니라 즉시가 된다.
   ══════════════════════════════════════════════════════════════ */

/** 지금 등급으로 살 수 있는 가장 싼 매물. 팝업이 이름으로 짚어 준다 */
const tutTarget = s => s.market.filter(c => !c.owned && c.cap <= capCeiling(s))
                                .sort((a, b) => a.cap - b.cap)[0] || null;

/*  id   — 상태 키
    n    — 체크리스트 한 줄
    hi   — 하이라이트할 버튼 ('' 이면 없음). CSS 가 body[data-tut=…] 로 받는다
    ok   — 완료 판정 (상태만 본다)
    body — 팝업 본문. 수치는 전부 BAL 에서 읽는다 — 상수와 설명이 갈라지면 안 된다 */
const TUT_STEPS = [
  {
    id: 'store', n: '사옥으로 들어간다', hi: 'store',
    ok: s => s.mode === 'store',
    title: '① 두 개의 화면',
    body: s => `<p>화면이 둘입니다.</p>
      <p style="margin-top:8px">· <b>도시</b> — 인수할 회사들이 건물로 서 있는 지도입니다. <b class="c-gold">금빛 건물</b>이 우리 사옥입니다.<br>
      · <b>사옥</b> — 우리 매장과 사무실입니다. <b>지금 돈이 나오는 곳은 여기</b>입니다.</p>
      <p style="margin-top:8px">사옥으로 들어가 보세요. 도시에서 금빛 건물을 클릭하거나, 위쪽 <b>사옥</b> 탭 또는 <span class="c-dim">Tab</span> 키를 쓰면 됩니다.</p>
      <p style="margin-top:8px" class="c-dim">${TIERS[s.co.tier].name} 승급 목표 — ${TIERS[s.co.tier].goal}</p>`,
  },
  {
    id: 'order', n: '재고를 발주한다', hi: 'shop',
    ok: s => !!s.flags.tut.order || s.co.autoOrder,
    title: '② 재고 — 매장에 들를 이유',
    body: () => `<p>재고는 매일 줄어듭니다. 만재에서 바닥까지 <b>${BAL.invDays}일</b>이고,
      바닥나면 매출이 <b class="c-blood">${Math.round(BAL.invFloor * 100)}%</b>까지 떨어집니다. 방치하면 그냥 손해입니다.</p>
      <p style="margin-top:8px"><b>매장</b> 창 → <b>발주</b> 에서 채우세요.
      한 번에 <b>50% 이상</b> 채우면 단가가 ${Math.round(BAL.invBulkOff * 100)}% 싸집니다.</p>
      <p style="margin-top:8px">손이 가는 게 싫으면 <b>자동 발주</b>를 켜도 됩니다. 대신 단가가
      <b>${Math.round(BAL.invAutoUp * 100)}%</b> 비쌉니다 — 편의를 돈으로 사는 선택입니다.</p>`,
  },
  {
    id: 'ad', n: '인지도를 올린다', hi: 'shop',
    ok: s => s.co.marketing > 1.001,
    title: '③ 인지도 — 손님을 부른다',
    body: () => `<p>인지도는 <b>손님 수와 매출에 곱해지는 배수</b>입니다. 상한 <b>×${BAL.marketingCap}</b>.</p>
      <p style="margin-top:8px"><b>매장</b> 창 → <b>운영</b> 에서 전단지나 광고 캠페인을 돌리세요.</p>
      <p style="margin-top:8px">매일 조금씩 떨어지므로(하루 ×${BAL.marketingDecay}) <b>한 번 올리고 끝이 아니라 꾸준히</b> 관리하는 값입니다.</p>`,
  },
  {
    id: 'team', n: '협상단에 직원을 넣는다', hi: 'staff',
    ok: s => teamOf(s, 0).length >= 1,
    title: '④ 협상단 — M&A 의 시작',
    body: () => `<p>여기서부터가 이 게임의 본편입니다. 회사를 사려면 <b>사람을 보내야</b> 합니다.</p>
      <p style="margin-top:8px"><b>사옥</b> 모드의 <b>직원</b> 창을 열고 <b>협상단</b> 버튼을 누르세요. 최대 3명입니다.</p>
      <p style="margin-top:8px">직원이 설 수 있는 자리는 셋뿐이고 <b>한 사람은 한 곳에만</b> 섭니다 —
      <b class="c-sky">협상단</b> · <b class="c-jade">매장 근무</b> · 계열사 관리.
      이 배분이 곧 전략입니다. 협상단의 <b>협상력 합계</b>가 성공도가 오르는 속도를 정합니다.</p>`,
  },
  {
    id: 'nego', n: '매물에 협상단을 파견한다', hi: 'city',
    ok: s => (s.negos || []).length >= 1 || s.co.subs.length >= 1,
    title: '⑤ 파견 — 도시로 나간다',
    body: s => {
      const t = tutTarget(s);
      return `<p><b>도시</b>로 나가 건물을 클릭하면 시가총액·난이도·예상 인수가가 뜹니다.</p>
      ${t ? `<p style="margin-top:8px">지금 등급으로 노려볼 만한 매물 — <b class="c-gold">${t.name}</b> (시총 ${won(t.cap)}).</p>` : ''}
      <p style="margin-top:8px"><b>자금이 모자라도 협상은 시작할 수 있습니다.</b> 성사되는 시점에 인수 대출로 메우면 됩니다 —
      인수한 회사가 담보라 못 갚으면 넘어갑니다.</p>
      <p style="margin-top:8px">파견하면 <b>진행도</b>가 하루 ${BAL.negoProgressPerDay}씩 차오릅니다(약 ${Math.ceil(100 / BAL.negoProgressPerDay)}일).
      100%에서 <b>성공도만큼의 확률</b>로 인수가 결정됩니다. 협상 중에도 매장 장사는 계속됩니다.</p>
      <p style="margin-top:8px" class="c-dim">'직접 협상'을 고르면 막판에 협상 테이블이 한 판 열립니다. 처음이라면 '맡긴다'로도 충분합니다.</p>`;
    },
  },
  {
    id: 'acq', n: '첫 인수를 완료한다', hi: '',
    ok: s => s.co.subs.length >= 1,
    title: '⑥ 인수 — 그리고 통합',
    body: () => `<p>협상이 성사되면 <b>인수가를 지불</b>해야 최종 완료입니다. 모자란 만큼은 인수 대출로 메웁니다.</p>
      <p style="margin-top:8px"><b>결렬될 수도 있습니다.</b> 진행도 100%에서 성공도가 모자라면 협상이 깨지고 협상단이 돌아옵니다 —
      드문 일이 아닙니다. 그때는 <b>같은 회사에 다시 파견하면 됩니다.</b> 잃는 것은 시간뿐입니다.</p>
      <p style="margin-top:8px">인수한 회사는 <b>통합에 ${BAL.pmiDays}일</b>이 걸립니다. 그동안은 <b class="c-blood">관리비만 나가고</b>
      수익은 ${Math.round(BAL.pmiFloor * 100)}%에서 서서히 올라옵니다 — 빚내서 연달아 사면 현금이 마르는 이유입니다.</p>
      <p style="margin-top:8px">통합이 끝나면 그 회사의 업종이 <b>상품군</b>으로 우리 매대에 오릅니다. M&amp;A 의 성과가 매장 화면에서 보입니다.</p>`,
  },
];

/** 이미 끝나 있는 단계를 **조용히** 채운다. 안 그러면 우수수 토스트가 뜬다 */
const tutPrefill = (s, t) => TUT_STEPS.forEach(st => { if (st.ok(s)) t.done[st.id] = 1; });

/**
 * 튜토리얼 상태. 구버전 세이브는 등급을 보고 이미 끝난 것으로 친다.
 *
 * **완료는 단계마다 따로 기록한다** (`done[id]`). 예전에는 포인터 하나(`i`)로
 * 순서대로만 열었는데, 그러면 ② 발주를 건너뛰고 ④ 협상단을 먼저 편성한
 * 플레이어에게 **이미 한 일이 ○ 로 남아 있었다.** 게임은 안 막히니 틀린 것은
 * 체크리스트뿐이지만, 나중에 ② 를 하는 순간 ②③④ 완료 토스트가 한꺼번에
 * 몰려 뜨고 ④ 설명 팝업은 영영 안 떴다.
 */
function tutState(s) {
  let t = s.flags.tut;
  if (!t) {
    t = s.flags.tut = { done: {}, shown: {}, off: s.co.tier > 1 || s.co.subs.length > 0, order: false };
    if (s.day > 1) tutPrefill(s, t);   // 튜토리얼 이전 세이브에 붙는 경우
  } else if (!t.done) {
    /* 순차 포인터(`i`) 시절 세이브. 필드를 갈아끼우고 끝난 단계는 상태에서
       다시 읽는다 — `i` 를 그대로 옮기면 순서 밖에서 끝낸 것이 누락된다. */
    t.done = {}; t.shown = {}; delete t.i;
    tutPrefill(s, t);
  }
  return t;
}

const tutOn = s => !!s && !tutState(s).off && !s.flags.ending;

/** 지금 안내할 단계 = **아직 안 한 것 중 가장 앞**. 전부 끝났으면 null */
const tutCur = s => TUT_STEPS.find(st => !tutState(s).done[st.id]) || null;

const tutDoneN = s => TUT_STEPS.filter(st => tutState(s).done[st.id]).length;

/** UI 쪽에서 "이 행동을 했다"고 알려 주는 훅. 상태만으로 못 가르는 것에만 쓴다 */
function tutDid(key) {
  if (!S || !S.flags) return;
  const t = tutState(S);
  if (!t.off) { t[key] = true; tutCheck(); }
}

/**
 * 한 프레임마다 불린다. 끝났으면 즉시 빠진다.
 *
 * **모든 단계를 매번 본다.** 순서를 강요하지 않으므로 앞질러 해 둔 단계도
 * 그 자리에서 체크되고, 안내는 남은 것 중 가장 앞으로만 간다.
 */
function tutCheck() {
  const s = S;
  if (!tutOn(s)) return;
  if ($('title-layer')?.classList.contains('on')) return;   // 타이틀 위에 뜨면 안 된다
  const t = tutState(s);
  let moved = false;
  for (const st of TUT_STEPS) {
    if (!t.done[st.id] && st.ok(s)) { t.done[st.id] = 1; toast(`튜토리얼 — ${st.n}`, 'good'); moved = true; }
  }
  const cur = tutCur(s);
  if (!cur) { tutFinish(s); return; }
  if (moved) renderTut();
  /* 팝업은 다른 모달이 없을 때만. 이벤트 모달 위에 겹치면 둘 다 안 읽힌다 */
  if (!t.shown[cur.id] && !modalStack.length) {
    t.shown[cur.id] = 1;
    renderTut();
    tutPopup(s, cur);
  }
}

function tutPopup(s, st) {
  pause();
  openModal({
    title: `튜토리얼 — ${st.title}`,
    body: st.body(s),
    /* **`resume()` 를 핸들러가 직접 불러야 한다.** modal.js 는 선택하고 닫는
       경로에서 시계를 복원해 주지 않는다 — ✕/Esc(`dismissModal`)만 복원한다.
       빠뜨리면 '알겠습니다'를 누른 순간 게임이 영영 멈춘다.

       **건너뛰기가 여기에도 있어야 한다.** 체크리스트의 버튼은 팝업을 닫아야
       보이므로, 안내가 필요 없는 사람도 일단 하나는 읽고 맵 구석의 작은 버튼을
       찾아내야 했다. `tutSkip` 이 확인 모달을 다시 띄우므로 시계는 그쪽에서
       푼다 — 여기서 resume 하면 안 된다. */
    actions: [
      { label: '알겠습니다', cls: 'gold', run: resume },
      { label: '건너뛰기', run: tutSkip },
    ],
  });
}

function tutFinish(s) {
  const t = tutState(s);
  t.off = true;
  renderTut();
  pause();
  openModal({
    title: '튜토리얼 완료',
    body: `<div style="text-align:center;padding:6px 0">
        <div style="font-size:15px" class="c-gold">첫 인수를 끝냈습니다</div>
        <div style="margin-top:8px;font-size:12px" class="c-dim">여기까지가 안내입니다. 이제부터는 판단이 전부 열려 있습니다.</div>
      </div>
      <div style="border-top:2px solid var(--paper-3);margin-top:10px;padding-top:10px;line-height:1.9">
        <b>핵심 루프</b> — 경영으로 자금 확보 → 매물 물색 → 협상단 파견 → 흡수·통합 → 등급 상승 → 더 큰 매물<br>
        <b>다음 목표</b> — ${TIERS[s.co.tier].goal}<br>
        <span class="c-dim">아직 안 다룬 것 — <b>시설 증설</b> · 은행 대출 · 주식과 미리 사두기 · 찌라시 · 협상 테이블 · 사장실 결재.
        전부 화면 우상단 <b>?</b> 버튼에 정리돼 있습니다.</span>
      </div>`,
    actions: [{ label: '시작하기', cls: 'gold', run: resume }],
  });
}

/** 건너뛰기 — 되돌릴 수 없으므로 한 번 묻는다 */
function tutSkip() {
  pause();
  openModal({
    title: '튜토리얼 건너뛰기',
    body: '<p>안내를 끄고 바로 진행합니다. <b>이 판에서는 다시 켜지지 않습니다.</b></p>'
        + '<p style="margin-top:8px" class="c-dim">설명은 화면 우상단 <b>?</b> 버튼에 그대로 남아 있습니다.</p>',
    actions: [
      { label: '계속 보기', run: resume },
      { label: '건너뛴다', cls: 'blood', run: () => { tutState(S).off = true; renderTut(); resume(); } },
    ],
  });
}

/* ── 체크리스트 ───────────────────────────────────────────── */
function renderTut() {
  const el = $('tut');
  if (!el) return;
  const s = S;
  if (!tutOn(s)) { el.classList.remove('on'); document.body.removeAttribute('data-tut'); return; }
  const t = tutState(s);
  const cur = tutCur(s);

  el.classList.add('on');
  document.body.dataset.tut = cur ? cur.hi : '';
  el.innerHTML = `
    <div class="tut-head">
      <b>튜토리얼</b><span>${tutDoneN(s)} / ${TUT_STEPS.length}</span>
      <button id="tut-again" title="지금 단계 설명 다시 보기">설명</button>
      <button id="tut-skip">건너뛰기</button>
    </div>
    <ul class="tut-list">
      ${TUT_STEPS.map(st => {
        const k = t.done[st.id] ? 'done' : st === cur ? 'now' : '';
        return `<li class="${k}"><i>${k === 'done' ? '✓' : k === 'now' ? '▶' : '·'}</i>${st.n}</li>`;
      }).join('')}
    </ul>`;
  $('tut-skip').onclick = tutSkip;
  $('tut-again').onclick = () => { if (cur && !modalStack.length) tutPopup(s, cur); };
}

export { TUT_STEPS, renderTut, tutCheck, tutCur, tutDid, tutDoneN, tutOn, tutPrefill, tutSkip, tutState };
