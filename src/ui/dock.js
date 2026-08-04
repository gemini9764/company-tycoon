import { sfx } from '../core/audio.js';
import { S } from '../core/state.js';
import { $ } from '../core/util.js';
import { zoomInto } from '../render/canvas.js';
import { fillIcons } from './icons.js';
import { openSettings } from './settings.js';
import { TAB, setTab } from './tabs.js';
import { toast } from './toast.js';

/* ══════════════════════════════════════════════════════════════
   DOCK — 상단 바 + 맵 위 모드 버튼

   버튼을 두 무리로 나눈다.
     · 상단 바   — 모드 토글, 카메라 회전, 그리고 **모드와 무관한** 찌라시·알림·설정
     · 맵 우상단 — 지금 모드에서만 쓰는 버튼. 도시면 회사·주식·은행,
                   사옥이면 직원·무당

   모드를 갈라 놓고 버튼을 전부 띄우면 모드를 가른 의미가 없다. 그래서 모드가
   바뀌면 그 모드에서 못 쓰는 창은 닫는다(`inMode`).
   ══════════════════════════════════════════════════════════════ */

/** 모드와 무관하게 늘 같은 자리에 있는 버튼 */
const FIXED = [
  { id: 'rumor',  n: '찌라시', icon: 'rumor', dot: s => s.rumors.some(r => !r.used) },
  { id: 'inbox',  n: '알림',   icon: 'inbox', dot: s => s.inbox.some(i => !i.read) },
  { id: 'config', n: '설정',   icon: 'config', act: openSettings },   // 창이 아니라 모달을 연다
];

/** 모드별 버튼. 도시는 M&A 축, 사옥은 사람 축. */
const MODE_BTNS = {
  city: [
    { id: 'co',    n: '회사', icon: 'company' },
    { id: 'stock', n: '주식', icon: 'stock' },
    { id: 'bank',  n: '은행', icon: 'bank' },
  ],
  store: [
    { id: 'shop',   n: '매장', icon: 'store' },
    { id: 'staff',  n: '직원', icon: 'staff' },
    { id: 'shaman', n: '무당', icon: 'shaman', lock: s => !s.shaman.unlocked, why: '스타트업 등급에서 해금' },
  ],
};

const TITLES = { co: '회사 현황', shop: '매장 운영', staff: '직원 · 협상단', stock: '주식시장', bank: '은행', shaman: '무당', rumor: '찌라시 네트워크', inbox: '알림함' };

const ALL = () => [...FIXED, ...MODE_BTNS.city, ...MODE_BTNS.store];

/** 지금 모드에서 열 수 있는 창인지 */
function inMode(id) {
  return FIXED.some(d => d.id === id) || (MODE_BTNS[S.mode] || []).some(d => d.id === id);
}

function btnHtml(d, s) {
  const locked = d.lock ? d.lock(s) : false;
  return `<button class="dbtn${locked ? ' locked' : ''}${TAB === d.id ? ' on' : ''}" data-t="${d.id}"
    ${locked ? `aria-disabled="true" title="${d.why}"` : ''}>
    <i data-ico="${d.icon}"></i><b>${d.n}</b>
    ${!locked && d.dot && d.dot(s) ? '<span class="dot"></span>' : ''}
    ${locked ? '<span class="lockbadge"><i data-ico="lock" data-ico-s="2"></i></span>' : ''}
  </button>`;
}

function bindBtns(root) {
  root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    sfx('tap');
    const d = ALL().find(x => x.id === b.dataset.t);
    if (d && d.lock && d.lock(S)) return toast(`${d.n} — ${d.why}`);
    d && d.act ? d.act() : setTab(b.dataset.t);
  });
}

function renderDock() {
  const s = S;
  $('dock').innerHTML = `
    <div class="mode-seg">
      <button class="mode-tab ${s.mode === 'city' ? 'on' : ''}" data-mode="city"><i data-ico="city"></i><b>도시</b></button>
      <button class="mode-tab ${s.mode === 'store' ? 'on' : ''}" data-mode="store"><i data-ico="store"></i><b>사옥</b></button>
    </div>
    <div class="dock-btns">${FIXED.map(d => btnHtml(d, s)).join('')}</div>`;

  fillIcons($('dock'));
  $('dock').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    if (b.dataset.mode !== S.mode) zoomInto(b.dataset.mode);
  });
  bindBtns($('dock'));

  renderModeBtns();
}

/** 맵 우상단에 얹히는 모드 전용 버튼 */
function renderModeBtns() {
  const el = $('modebtns');
  if (!el) return;
  el.innerHTML = (MODE_BTNS[S.mode] || []).map(d => btnHtml(d, S)).join('');
  fillIcons(el);
  bindBtns(el);
}

/** 버튼 창 제목. 닫혀 있으면 빈 문자열. */
function panelTitle() { return TITLES[TAB] || ''; }

export { ALL, FIXED, MODE_BTNS, TITLES, bindBtns, btnHtml, inMode, panelTitle, renderDock, renderModeBtns };
