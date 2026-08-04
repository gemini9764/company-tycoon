import './debug.js';   // QA 핸들 (window.game)
import { unlockAudio, startBgm } from './core/audio.js';
import { BAL } from './core/balance.js';
import { TIERS } from './core/data.js';
import { frameLoop } from './core/loop.js';
import { S, newState, setS } from './core/state.js';
import { SAVE_KEY, Store, loadGame, loadPrefs, saveInfo } from './core/storage.js';
import { $, won } from './core/util.js';
import { initCanvas, rotateCity, setMode, zoomBy, zoomInto } from './render/canvas.js';
import { renderHud } from './ui/hud.js';
import { closePanel, renderAll } from './ui/index.js';
import { closeModal, modalStack, openModal } from './ui/modal.js';
import { hideTitle, setExitHandler, showTitle } from './ui/title.js';
import { news, pushInbox, toggleNews } from './ui/toast.js';

/* ── 부팅 ────────────────────────────────────────────────── */
async function boot() {
  await Store.init();
  await loadPrefs();
  initCanvas();

  // 모드 전환 버튼은 독이 매번 다시 그리므로 핸들러도 그쪽에서 건다
  $('panel-x').onclick = closePanel;
  $('news-toggle').onclick = toggleNews;
  $('panel-layer').onclick = e => { if (e.target.id === 'panel-layer') closePanel(); };
  document.addEventListener('keydown', e => {
    if (!S) return;
    if (e.key === ' ') { e.preventDefault(); S.speed = S.speed ? 0 : 1; renderHud(); }
    if (e.key === 'Tab') { e.preventDefault(); zoomInto(S.mode === 'city' ? 'store' : 'city'); }
    const k = e.key.toLowerCase();
    if (k === 'q') rotateCity(-1);
    if (k === 'e') rotateCity(1);
    if (e.key === '+' || e.key === '=') zoomBy(1);
    if (e.key === '-' || e.key === '_') zoomBy(-1);
    if (e.key === 'Escape') {
      if (modalStack.length) { if (modalStack[modalStack.length - 1].dismissable !== false) closeModal(); }
      else closePanel();
    }
  });

  // 자동재생 정책 — AudioContext 는 사용자 제스처에서만 열린다
  const wake = () => { unlockAudio(); startBgm(); };
  document.addEventListener('pointerdown', wake, { once: true });
  document.addEventListener('keydown', wake, { once: true });

  setExitHandler(backToTitle);
  await openTitle();
}

/** 타이틀 메뉴. 부팅과 '메인 타이틀로' 가 같은 것을 쓴다. */
async function openTitle() {
  showTitle(await saveInfo(), {
    onNew: () => { Store.del(SAVE_KEY); hideTitle(); intro(); },
    onContinue: async () => {
      const saved = await loadGame();
      if (!saved) return;                       // 그사이 지워졌다면 타이틀에 머문다
      setS(saved); S.speed = 0;
      setMode(S.mode || 'city'); renderAll();
      hideTitle(); startLoop();
      S.speed = 1; renderHud();
    },
  });
}

/* 렌더 루프는 S 가 생긴 뒤에만 돈다. 타이틀에서는 draw() 가 볼 상태가 없다. */
let looping = false;

function startLoop() {
  if (looping) return;
  looping = true;
  requestAnimationFrame(frameLoop);
}

/* 설정에서 '메인 타이틀로'. 시간을 멈추고 열린 창을 접은 뒤 타이틀을 다시 띄운다.
   루프는 그대로 두고 S 만 정지시킨다 — draw() 는 마지막 화면을 계속 그리지만
   타이틀 레이어가 덮으므로 보이지 않는다. */
async function backToTitle() {
  if (S) S.speed = 0;
  closePanel();
  while (modalStack.length) closeModal();
  await openTitle();
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
        · 도시는 <b>드래그로 이동</b>, <b>휠로 확대</b>합니다 (1x~3x).<br>
        · <span class="c-dim">Space 일시정지 · Tab 모드 전환 · Q·E 회전 · +·− 확대 · Esc 창 닫기</span>
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
  startLoop();
}

boot();
