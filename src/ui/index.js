import { S } from '../core/state.js';
import { $ } from '../core/util.js';
import { renderHud } from './hud.js';
import { renderLeft } from './panelLeft.js';
import { renderRight } from './tabs.js';

/* ── 상단 모드바 ─────────────────────────────────────────── */
function renderTopBar() {
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('board-hint').textContent = S.mode === 'city'
    ? '건물 클릭 → 회사 정보 · 금빛 건물이 우리 회사'
    : '손님이 물건을 사고 나갑니다 · 인지도가 오르면 손님이 늘어납니다';
}

function renderAll() { renderHud(); renderLeft(); renderRight(); renderTopBar(); }

export { renderAll, renderTopBar };
