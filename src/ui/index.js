import { S } from '../core/state.js';
import { $ } from '../core/util.js';
import { inMode, panelTitle, renderDock } from './dock.js';
import { renderHud } from './hud.js';
import { renderLeft } from './panelLeft.js';
import { renderShop } from './shopPanel.js';
import { TAB, renderRight, setTab } from './tabs.js';
import { renderNews } from './toast.js';
import { renderTut } from './tutorial.js';

/* ── 맵 위 안내문 ────────────────────────────────────────── */
function renderTopBar() {
  $('board-hint').textContent = S.mode === 'city'
    ? '도시 — 건물 클릭 → 회사 정보 · 금빛 건물이 우리 사옥 · Tab 전환'
    : '사옥 — 왼쪽은 매장, 오른쪽은 사무실과 사장실 · Tab 전환';
  if (TAB && !inMode(TAB)) return setTab(null);   // setTab 이 독과 창을 다시 그린다
  renderDock();
}

/* ── 버튼 창 ─────────────────────────────────────────────────
   좌우 상시 패널을 없앤 대신, 상단 독의 버튼으로 여는 창 하나가 모든 내용을 받는다.
   내용을 그리는 쪽(panelLeft / tabs)은 열려 있을 때만 일하도록 스스로 막는다.
   ─────────────────────────────────────────────────────────── */
function renderPanel() {
  const on = !!TAB;
  $('panel-layer').classList.toggle('on', on);
  if (!on) return;
  $('panel-title').textContent = panelTitle();
  if (TAB === 'co') renderLeft();
  else if (TAB === 'shop') renderShop();
  else renderRight();
}

function closePanel() { setTab(null); }

function renderAll() { renderHud(); renderDock(); renderPanel(); renderNews(); renderTopBar(); renderTut(); }

export { closePanel, renderAll, renderPanel, renderTopBar };
