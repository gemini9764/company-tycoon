import { TIERS } from '../core/data.js';
import { debtTotal } from '../core/derive.js';
import { S } from '../core/state.js';
import { saveGame } from '../core/storage.js';
import { $, esc, won } from '../core/util.js';
import { creditIdx, creditName } from '../systems/company.js';
import { HELP_HTML } from './help.js';
import { openModal } from './modal.js';
import { setTab, TAB } from './tabs.js';

/* ── HUD ─────────────────────────────────────────────────── */
function renderHud() {
  const s = S, debt = debtTotal(s);
  const share = s.market.length ? Math.round(s.co.subs.length / (s.market.length + 1) * 100) : 0;
  $('hud').innerHTML = `
    <div class="hud-id"><b>${esc(s.co.name)}</b><span>${TIERS[s.co.tier].name} · ${s.co.subs.length}개 계열사</span></div>
    <div class="hud-stat"><i>자금</i><b class="${s.co.cash < 0 ? 'c-blood' : 'c-gold'}">${won(s.co.cash)}</b></div>
    <div class="hud-stat"><i>시가총액</i><b>${won(s.co.cap)}</b></div>
    <div class="hud-stat"><i>시총 순위</i><b class="c-sky">${s.co.rank.toLocaleString()}위</b></div>
    <div class="hud-stat"><i>시장 지분율</i><b>${share}%</b></div>
    <div class="hud-stat"><i>신용 등급</i><b class="${creditIdx(s) >= 7 ? 'c-jade' : creditIdx(s) <= 3 ? 'c-blood' : ''}">${creditName(s)}</b></div>
    <div class="hud-stat"><i>부채</i><b class="${debt ? 'c-blood' : 'c-dim'}">${debt ? won(debt) : '없음'}</b></div>
    <div class="hud-spacer"></div>
    <div class="hud-ctrl">
      <span style="font-size:10px;color:#8F9BC4;margin-right:6px">${Math.floor(s.day / 30) + 1}년차 ${s.day % 30 || 30}일</span>
      ${[0, 1, 2, 4].map(v => `<button class="spd ${s.speed === v ? 'on' : ''}" data-spd="${v}">${v ? v + 'x' : '❚❚'}</button>`).join('')}
      <button class="bell ${s.inbox.some(i => !i.read) ? 'has' : ''}" id="bell">✉</button>
      <button class="mini-btn" id="btn-help">?</button>
      <button class="mini-btn" id="btn-save">저장</button>
    </div>`;
  $('hud').querySelectorAll('[data-spd]').forEach(b => b.onclick = () => { S.speed = +b.dataset.spd; renderHud(); });
  $('bell').onclick = () => { setTab('inbox'); };
  $('btn-save').onclick = () => saveGame();
  $('btn-help').onclick = () => openModal({ title: '조작 · 핵심 루프', body: HELP_HTML });
}

export { renderHud };
