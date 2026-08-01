import { S } from '../core/state.js';
import { $ } from '../core/util.js';
import { zoomInto } from '../render/canvas.js';
import { fillIcons } from './icons.js';
import { TAB, setTab } from './tabs.js';

/* ══════════════════════════════════════════════════════════════
   DOCK — 상단 아이콘 바 (월간 아이돌 계열 UI 참고)

   좌우 상시 패널을 없애고 맵이 화면을 꽉 채우게 한 뒤, 모든 정보는 여기서
   버튼으로 연다. HUD 바로 아래에 붙어 위쪽이 조작부, 그 아래가 전부 맵이다.
   맨 왼쪽은 모드 토글, 오른쪽은 기능 버튼 7개.
   ══════════════════════════════════════════════════════════════ */
const DOCK = [
  { id: 'co',     n: '회사',   icon: 'company' },
  { id: 'staff',  n: '직원',   icon: 'staff' },
  { id: 'stock',  n: '주식',   icon: 'stock' },
  { id: 'bank',   n: '은행',   icon: 'bank' },
  { id: 'shaman', n: '무당',   icon: 'shaman', lock: s => !s.shaman.unlocked, why: '스타트업 등급부터' },
  { id: 'rumor',  n: '찌라시', icon: 'rumor',  dot: s => s.rumors.some(r => !r.used) },
  { id: 'inbox',  n: '알림',   icon: 'inbox',  dot: s => s.inbox.some(i => !i.read) },
];

const TITLES = { co: '회사 현황', staff: '직원 · 협상단', stock: '주식시장', bank: '은행', shaman: '무당', rumor: '찌라시 네트워크', inbox: '알림함' };

function renderDock() {
  const s = S;
  $('dock').innerHTML = `
    <div class="mode-seg">
      <button class="mode-tab ${s.mode === 'city' ? 'on' : ''}" data-mode="city"><i data-ico="city"></i><b>도시</b></button>
      <button class="mode-tab ${s.mode === 'store' ? 'on' : ''}" data-mode="store"><i data-ico="store"></i><b>사옥</b></button>
    </div>
    <div class="dock-btns">${DOCK.map(d => {
      const locked = d.lock ? d.lock(s) : false;
      return `<button class="dbtn ${TAB === d.id ? 'on' : ''}" data-t="${d.id}"
        ${locked ? `disabled title="${d.why}"` : ''}>
        <i data-ico="${d.icon}"></i><b>${d.n}</b>
        ${!locked && d.dot && d.dot(s) ? '<span class="dot"></span>' : ''}
        ${locked ? '<span class="lock">잠김</span>' : ''}
      </button>`;
    }).join('')}</div>`;

  fillIcons($('dock'));
  $('dock').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    if (b.dataset.mode !== S.mode) zoomInto(b.dataset.mode);
  });
  $('dock').querySelectorAll('[data-t]').forEach(b => b.onclick = () => setTab(b.dataset.t));
}

/** 버튼 창 제목. 닫혀 있으면 빈 문자열. */
function panelTitle() { return TITLES[TAB] || ''; }

export { DOCK, TITLES, panelTitle, renderDock };
