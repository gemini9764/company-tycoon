import { SND, applyVolumes, sfx, startBgm, stopBgm, unlockAudio } from '../core/audio.js';
import { saveGame, savePrefs } from '../core/storage.js';
import { $ } from '../core/util.js';
import { closeModal, modalStack, openModal, renderModal } from './modal.js';
import { canExit, exitToTitle } from './title.js';

/* ══════════════════════════════════════════════════════════════
   SETTINGS — 사운드 + 타이틀 복귀

   사운드 항목은 ROWS 에 한 줄 추가하는 형태로 늘린다.

   '메인 타이틀로' 는 게임 중에만 띄운다. 타이틀에서 연 설정에는 나올 이유가
   없고, 저장 이후 진행분이 날아가므로 반드시 한 번 물어본다.

   설정값은 세이브와 다른 키에 저장한다. 새 게임을 시작해도 유지돼야 하고,
   세이브 포맷이 바뀌어 구버전 세이브가 폐기될 때 같이 날아가면 안 된다.
   ══════════════════════════════════════════════════════════════ */
const ROWS = [
  { k: 'master', n: '전체 볼륨' },
  { k: 'bgm', n: '배경음' },
  { k: 'sfx', n: '효과음' },
];

function settingsBody() {
  return `
    <div class="set-row set-mute">
      <span>음소거</span>
      <button class="btn ${SND.muted ? 'gold' : ''}" id="set-mute">${SND.muted ? '켜짐' : '꺼짐'}</button>
    </div>
    ${ROWS.map(r => `
      <div class="set-row ${SND.muted ? 'off' : ''}">
        <span>${r.n}</span>
        <input type="range" min="0" max="100" step="5" value="${Math.round(SND[r.k] * 100)}"
          data-vol="${r.k}" ${SND.muted ? 'disabled' : ''}>
        <b id="set-v-${r.k}">${Math.round(SND[r.k] * 100)}</b>
      </div>`).join('')}
    <p class="c-dim" style="margin-top:10px;font-family:var(--f-sm);font-size:10px">
      효과음은 슬라이더를 놓을 때 한 번 들려줍니다. 설정은 저장 데이터와 따로 보관되어 새 게임에서도 유지됩니다.</p>
    ${canExit() ? `<div class="set-exit">
      <button class="btn wide" id="set-title">메인 타이틀로</button>
      <p class="c-dim" style="margin-top:6px;font-family:var(--f-sm);font-size:10px">
        마지막 저장 이후의 진행은 사라집니다. 나가기 전에 저장할지 물어봅니다.</p>
    </div>` : ''}`;
}

/** 모달을 다시 그리지 않고 값만 갱신한다 — 드래그 중 슬라이더가 튀지 않게. */
function bindSettings() {
  const mute = $('set-mute');
  if (!mute) return;
  mute.onclick = () => {
    SND.muted = !SND.muted;
    applyVolumes();
    SND.muted ? stopBgm() : startBgm();
    savePrefs();
    /* 음소거는 아래 슬라이더의 활성 상태까지 바꾼다. renderModal 은 cfg.body 를
       그대로 다시 그리므로, 본문 문자열을 새로 만들어 넣어야 화면이 따라온다.
       (이걸 빼먹으면 창을 닫았다 열어야 반영된다) */
    const cfg = modalStack[modalStack.length - 1];
    if (cfg) cfg.body = settingsBody();
    renderModal();                                  // onOpen 훅이 bindSettings 를 다시 건다
  };
  const exit = $('set-title');
  if (exit) exit.onclick = () => {
    closeModal();                                   // 설정 위에 확인창을 겹치지 않는다
    openModal({
      title: '메인 타이틀로',
      body: '<p>마지막 저장 이후의 진행은 사라집니다.</p>',
      choices: [
        { label: '저장하고 나가기', sub: '현재 상태를 덮어씁니다', run: async () => { await saveGame(true); exitToTitle(); } },
        { label: '저장 없이 나가기', run: exitToTitle },
        { label: '취소', run: () => {} },
      ],
    });
  };
  document.querySelectorAll('[data-vol]').forEach(el => {
    el.oninput = () => {
      const k = el.dataset.vol;
      SND[k] = +el.value / 100;
      applyVolumes();
      const out = $('set-v-' + k); if (out) out.textContent = el.value;
    };
    el.onchange = () => { savePrefs(); if (el.dataset.vol !== 'bgm') sfx('coin'); };
  });
}

function openSettings() {
  unlockAudio();
  openModal({
    title: '설정',
    body: settingsBody(),
    onOpen: bindSettings,
    actions: [{ label: '닫기', run: () => {} }],
  });
}

export { ROWS, bindSettings, openSettings, settingsBody };
