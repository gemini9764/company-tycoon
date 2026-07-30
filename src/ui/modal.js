import { $ } from '../core/util.js';

/* ── 모달 ────────────────────────────────────────────────── */
let modalStack = [];

function openModal(cfg) {
  modalStack.push(cfg);
  renderModal();
}

function closeModal() { modalStack.pop(); renderModal(); }

function renderModal() {
  const layer = $('modal-layer'), cfg = modalStack[modalStack.length - 1];
  if (!cfg) { layer.classList.remove('on'); return; }
  layer.classList.add('on');
  $('modal').innerHTML = `
    <div class="modal-head"><span>${cfg.title}</span>${cfg.dismissable === false ? '' : '<button class="btn" id="mx">✕</button>'}</div>
    <div class="modal-body">
      ${cfg.body || ''}
      ${(cfg.choices || []).map((c, i) => `
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
}

export { closeModal, modalStack, openModal, renderModal };
