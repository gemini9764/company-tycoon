import './debug.js';   // QA 핸들 (window.game)
import { BAL } from './core/balance.js';
import { TIERS } from './core/data.js';
import { frameLoop } from './core/loop.js';
import { S, newState, setS } from './core/state.js';
import { SAVE_KEY, Store, loadGame } from './core/storage.js';
import { $, esc, won } from './core/util.js';
import { initCanvas, setMode, zoomInto } from './render/canvas.js';
import { renderHud } from './ui/hud.js';
import { closePanel, renderAll } from './ui/index.js';
import { closeModal, modalStack, openModal } from './ui/modal.js';
import { news, pushInbox, toggleNews } from './ui/toast.js';

/* ── 부팅 ────────────────────────────────────────────────── */
async function boot() {
  await Store.init();
  initCanvas();

  // 모드 전환 버튼은 독이 매번 다시 그리므로 핸들러도 그쪽에서 건다
  $('panel-x').onclick = closePanel;
  $('news-toggle').onclick = toggleNews;
  $('panel-layer').onclick = e => { if (e.target.id === 'panel-layer') closePanel(); };
  document.addEventListener('keydown', e => {
    if (!S) return;
    if (e.key === ' ') { e.preventDefault(); S.speed = S.speed ? 0 : 1; renderHud(); }
    if (e.key === 'Tab') { e.preventDefault(); zoomInto(S.mode === 'city' ? 'store' : 'city'); }
    if (e.key === 'Escape') {
      if (modalStack.length) { if (modalStack[modalStack.length - 1].dismissable !== false) closeModal(); }
      else closePanel();
    }
  });

  const saved = await loadGame();
  if (saved) {
    setS(saved); S.speed = 0;
    setMode(S.mode || 'city'); renderAll();
    openModal({
      title: '이어서 하기',
      body: `<p>저장된 게임이 있습니다.</p>
        <div class="kv" style="margin-top:10px"><span>회사</span><b>${esc(S.co.name)}</b></div>
        <div class="kv"><span>등급</span><b>${TIERS[S.co.tier].name}</b></div>
        <div class="kv"><span>경과</span><b>${S.day}일차</b></div>
        <div class="kv"><span>자금</span><b>${won(S.co.cash)}</b></div>`,
      choices: [
        { label: '이어서 하기', run: () => { S.speed = 1; renderAll(); } },
        { label: '새로 시작', sub: '저장 데이터를 지웁니다', run: () => { Store.del(SAVE_KEY); intro(); } },
      ],
      dismissable: false,
    });
  } else intro();

  requestAnimationFrame(frameLoop);
}

function intro() {
  setS(newState());
  setMode('city');
  renderAll();
  openModal({
    title: '컴퍼니 타이쿤 — 창업',
    dismissable: false,
    body: `
      <p style="line-height:1.9">구멍가게 하나로 시작합니다. 장사로 자본을 모으고, 협상단을 보내 경쟁사를 인수하며 그룹을 키우세요.</p>
      <div style="margin:12px 0">
        <div style="font-size:10px;font-family:var(--f-sm)" class="c-dim">회사명</div>
        <input id="co-name" value="한별상사" maxlength="10"
          style="width:100%;margin-top:4px;padding:8px;font-family:inherit;font-size:15px;font-family:var(--f-lg);background:var(--paper-2);border:2px solid var(--ink);color:var(--ink)">
      </div>
      <div style="border-top:2px solid var(--paper-3);padding-top:10px;font-size:12px;line-height:2">
        <b>흐름</b><br>
        · <b>도시</b>에서 <b class="c-gold">금빛 건물</b>이 우리 사옥입니다. 클릭하면 <b>사옥</b> 안으로 들어갑니다.<br>
        · 다른 건물을 클릭하면 인수 대상 정보가 뜹니다. <b class="c-sky">협상단</b>을 파견하면 진행도가 차오릅니다.<br>
        · 협상 중에도 사옥의 장사는 계속됩니다. 진행도 100%에서 <b>성공도만큼의 확률</b>로 인수가 결정됩니다.<br>
        · 인수가를 못 내면 인수는 불발됩니다. 은행 대출로 메울 수 있지만 원리금은 갚아야 합니다.<br>
        · 화면 위 아이콘 버튼으로 회사·직원·주식·은행 창을 엽니다.<br>
        · <span class="c-dim">Space 일시정지 · Tab 모드 전환 · Esc 창 닫기</span>
      </div>`,
    actions: [{ label: '창업하기', cls: 'gold', run: () => {
      const v = ($('co-name')?.value || '').trim();
      S.co.name = v || '한별상사';
      S.speed = 1;
      news(`${S.co.name} 설립 — 자본금 ${won(BAL.startCash)}`);
      pushInbox(S, '창업', `${S.co.name}이(가) 문을 열었습니다. 첫 목표는 ${TIERS[0].goal}입니다.`, 'good');
      renderAll();
    } }],
  });
}

boot();
