import { sfx } from '../core/audio.js';
import { resume } from '../core/clock.js';
import { $ } from '../core/util.js';

/* ── 모달 ────────────────────────────────────────────────── */
let modalStack = [];

function openModal(cfg) {
  modalStack.push(cfg);
  sfx('open');
  renderModal();
}

function closeModal() { modalStack.pop(); sfx('close'); renderModal(); }

/**
 * ✕ 버튼 · Esc 로 **선택하지 않고** 닫는 경로.
 *
 * `pause()` 한 뒤 열린 모달을 여기로 닫으면 `resume()` 이 선택지 핸들러 안에만
 * 있어서 **시계가 0 에 멈춘 채 영영 안 돌아왔다.** 배속 버튼으로 억지로 풀면
 * `pausedSpeed` 가 오염돼 그 뒤로는 모달이 떠도 게임이 안 멈춘다 —
 * §13-1 이 `completeAcq` 예외로 겪었던 그 증상을, **Esc 한 번으로** 재현할 수
 * 있었다. `safeRun` 이 예외만 막고 있었지 이 경로는 비어 있었다.
 *
 * 마지막 모달이 닫힐 때만 푼다. 중첩 모달의 위쪽만 닫는 경우에는 아래 모달이
 * 여전히 결정을 기다리므로 멈춘 채로 두는 게 맞다.
 */
function dismissModal(cfg) {
  closeModal();
  safeRun(cfg?.onClose);
  if (!modalStack.length) resume();
}

/**
 * 선택지 핸들러는 대부분 `pause()` 로 멈춘 상태에서 불리고 마지막 줄에서
 * `resume()` 한다. 중간에 예외가 나면 그 `resume()` 이 통째로 날아가
 * **시계가 죽고**(speed 0 고정) `pausedSpeed` 도 복원되지 않아 그 뒤로는
 * 모달이 떠도 게임이 안 멈춘다 — 예외 하나가 게임 전체를 못 쓰게 만든다.
 *
 * 실제로 `completeAcq` 안의 TypeError 가 이 경로로 새어 그 증상을 냈다.
 * 원인은 고쳤지만, 같은 형태의 사고는 여기를 지나는 어떤 코드로도 재현된다.
 * 그래서 단일 실패점인 이 지점에서 막는다.
 */
function safeRun(fn) {
  if (!fn) return;
  try { fn(); } catch (e) { console.error('모달 핸들러 예외 —', e); resume(); }
}

function renderModal() {
  const layer = $('modal-layer'), cfg = modalStack[modalStack.length - 1];
  if (!cfg) { layer.classList.remove('on'); return; }
  layer.classList.add('on');
  $('modal').innerHTML = `
    <div class="modal-head"><span>${cfg.title}</span>${cfg.dismissable === false ? '' : '<button class="btn" id="mx">✕</button>'}</div>
    <div class="modal-body">
      ${cfg.body || ''}
      ${(cfg.choices || []).map((c, i) => `
        ${c.head ? `<div class="meta" style="margin-top:9px;border-top:1px solid var(--paper-3);padding-top:7px">${c.head}</div>` : ''}
        <button class="choice" data-i="${i}" ${c.dis ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>
          ${c.label}${c.sub ? `<small>${c.sub}</small>` : ''}
        </button>`).join('')}
    </div>
    ${(cfg.actions || []).length ? `<div class="modal-foot">${cfg.actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-a="${i}">${a.label}</button>`).join('')}</div>` : ''}`;
  $('modal').querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
    const c = cfg.choices[+b.dataset.i]; closeModal(); safeRun(c.run);
  });
  $('modal').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = cfg.actions[+b.dataset.a]; closeModal(); safeRun(a.run);
  });
  const x = $('mx'); if (x) x.onclick = () => dismissModal(cfg);
  // 모달 본문에 직접 손을 대야 하는 화면(설정의 슬라이더 등)이 쓰는 훅
  safeRun(cfg.onOpen);
}

export { closeModal, dismissModal, modalStack, openModal, renderModal };
