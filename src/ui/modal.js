import { sfx } from '../core/audio.js';
import { $ } from '../core/util.js';

/* ── 모달 ────────────────────────────────────────────────── */
let modalStack = [];

function openModal(cfg) {
  modalStack.push(cfg);
  sfx('open');
  renderModal();
}

function closeModal() { modalStack.pop(); sfx('close'); renderModal(); }

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
    const c = cfg.choices[+b.dataset.i]; closeModal(); c.run && c.run();
  });
  $('modal').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = cfg.actions[+b.dataset.a]; closeModal(); a.run && a.run();
  });
  const x = $('mx'); if (x) x.onclick = () => { closeModal(); cfg.onClose && cfg.onClose(); };
  // 모달 본문에 직접 손을 대야 하는 화면(설정의 슬라이더 등)이 쓰는 훅
  cfg.onOpen && cfg.onOpen();
}

export { closeModal, modalStack, openModal, renderModal };
