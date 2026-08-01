import { BAL } from '../core/balance.js';
import { SECTORS, SHAMAN_TIERS } from '../core/data.js';
import { sumStat, teamOf } from '../core/derive.js';
import { S, makeStaff } from '../core/state.js';
import { $, clamp, esc, won } from '../core/util.js';
import { teamPower } from '../systems/company.js';
import { managersHave, managersNeeded } from '../systems/economy.js';
import { useRumor } from '../systems/rumor.js';
import { doGut, shamanFee } from '../systems/shaman.js';
import { buyStock, sellStock } from '../systems/stock.js';
import { tabBank } from './bankPanel.js';
import { renderHud } from './hud.js';
import { renderAll, renderPanel } from './index.js';
import { renderLeft } from './panelLeft.js';
import { renderDock } from './dock.js';
import { toast } from './toast.js';

/* 하단 버튼으로 여는 창이 하나뿐이라, 지금 열려 있는 창의 id 를 여기서 쥔다.
   null 이면 닫힌 상태다. */
let TAB = null;

const TABS = ['staff', 'stock', 'bank', 'shaman', 'rumor', 'inbox'];

let STOCK_VIEW = 'all';   // 주식 창 안의 서브탭: 시장 전체 / 관심

/** 창을 열고 닫는 유일한 통로. 같은 버튼을 다시 누르면 닫힌다. */
function setTab(id) {
  TAB = (TAB === id) ? null : id;
  renderDock(); renderPanel();
}

function renderRight() {
  if (!TABS.includes(TAB)) return;          // 닫혀 있거나 회사 창이면 할 일 없음
  ({ staff: tabStaff, stock: tabStock, bank: tabBank, shaman: tabShaman, rumor: tabRumor, inbox: tabInbox })[TAB]();
}

/* 직원 */
function tabStaff() {
  const s = S, team = teamOf(s);
  const chip = e => `<span class="stat-chip">협상 ${e.nego}</span><span class="stat-chip">정보 ${e.intel}</span><span class="stat-chip">영업 ${e.sales}</span><span class="stat-chip">재무 ${e.fin}</span>`;
  let h = `<div class="row" style="border-color:var(--sky)">
    <h4 class="c-sky">협상단 ${team.length}/3</h4>
    <div class="kv"><span>협상력 합계</span><b>${Math.round(teamPower(s))}</b></div>
    <div class="kv"><span>정보력 합계</span><b>${Math.round(sumStat(team, 'intel'))}</b></div>
    <div class="meta">협상력은 성공도 상승 속도를, 정보력은 인수가 프리미엄과 찌라시 획득률을 좌우합니다.</div>
  </div>
  <div class="row" style="border-color:${managersHave(s) < managersNeeded(s) ? 'var(--blood)' : 'var(--jade)'}">
    <h4>관리 인력 ${managersHave(s)} / ${managersNeeded(s)}</h4>
    <div class="meta">협상단에 넣지 않은 직원이 계열사를 관리합니다. 계열사 ${BAL.subsPerManager}개당 1명이 필요하고, 모자라면 그룹 운영 효율이 계열사 수익 전체에서 깎입니다. 협상단에 몰아넣을수록 인수는 빨라지지만 그룹은 새어나갑니다.</div>
  </div>`;

  h += `<div class="row"><h4>사원 ${s.staff.length}명<span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">월 급여 ${won(s.staff.reduce((a, e) => a + e.salary, 0))}</span></h4></div>`;
  h += s.staff.map(e => `<div class="row tight">
      <h4>${esc(e.name)} <span style="font-size:10px;font-family:var(--f-sm)" class="${e.onTeam ? 'c-sky' : 'c-dim'}">${e.onTeam ? '협상단' : 'Lv.' + e.lv}</span></h4>
      <div>${chip(e)}</div>
      <div class="meta">${e.trait.name} — ${e.trait.desc} · 월급 ${won(e.salary)}</div>
      <div class="btn-row">
        <button class="btn ${e.onTeam ? '' : 'sky'}" data-team="${e.id}" ${!e.onTeam && team.length >= 3 ? 'disabled' : ''}>${e.onTeam ? '협상단 제외' : '협상단 편성'}</button>
        <button class="btn" data-train="${e.id}">교육 ${won(trainCost(e))}</button>
        <button class="btn blood" data-fire="${e.id}">해고</button>
      </div></div>`).join('');

  h += `<div class="row" style="margin-top:10px"><h4>스카웃 시장</h4>
    <div class="meta">능력치가 높을수록 연봉 요구치가 올라갑니다.</div></div>`;
  h += s.recruits.map((e, i) => `<div class="row tight">
      <h4>${esc(e.name)} <span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${e.grade}급</span></h4>
      <div>${chip(e)}</div>
      <div class="meta">${e.trait.name} — ${e.trait.desc}</div>
      <div class="btn-row">
        <button class="btn gold" data-hire="${i}" ${s.co.cash < e.salary * 3 ? 'disabled' : ''}>영입 (계약금 ${won(e.salary * 3)})</button>
      </div></div>`).join('');
  h += `<button class="btn wide" id="reroll" style="margin-top:4px">시장 새로고침 ${won(rerollCost(s))}</button>`;

  $('panel-body').innerHTML = h;
  const R = $('panel-body');
  R.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
    const e = s.staff.find(x => x.id === b.dataset.team);
    if (s.nego && e.onTeam) return toast('협상 중에는 협상단을 뺄 수 없습니다', 'bad');
    e.onTeam = !e.onTeam; renderRight(); renderLeft();
  });
  R.querySelectorAll('[data-train]').forEach(b => b.onclick = () => {
    const e = s.staff.find(x => x.id === b.dataset.train), c = trainCost(e);
    if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c; e.lv++; e.salary = Math.round(e.salary * 1.12);
    toast(`${e.name} Lv.${e.lv} — 전 능력치 실효 +15%`, 'good'); renderRight(); renderHud();
  });
  R.querySelectorAll('[data-fire]').forEach(b => b.onclick = () => {
    const i = s.staff.findIndex(x => x.id === b.dataset.fire);
    if (s.nego && s.staff[i].onTeam) return toast('협상 중인 인원은 해고할 수 없습니다', 'bad');
    toast(`${s.staff[i].name} 퇴사`); s.staff.splice(i, 1); renderRight(); renderLeft();
  });
  R.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => {
    const i = +b.dataset.hire, e = s.recruits[i], fee = e.salary * 3;
    if (s.co.cash < fee) return toast('계약금이 부족합니다', 'bad');
    s.co.cash -= fee; s.recruits.splice(i, 1); s.staff.push(e);
    toast(`${e.name} 입사`, 'good'); renderRight(); renderHud();
  });
  $('reroll').onclick = () => {
    const c = rerollCost(s); if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c;
    const g = clamp(1 + Math.floor(s.co.tier * 0.8), 1, 5);
    s.recruits = [makeStaff(g), makeStaff(g), makeStaff(clamp(g + 1, 1, 5))];
    renderRight(); renderHud();
  };
}

const trainCost = e => Math.round(300000 * Math.pow(1.9, e.lv));

const rerollCost = s => Math.round(Math.max(5e5, s.co.cap * 0.004));

/* 주식 */
function tabStock() {
  const s = S;
  const listed = s.market.filter(c => c.listed && !c.owned);
  const watch = listed.filter(c => s.stock.watch.includes(c.id));
  const held = Object.keys(s.stock.holds);
  const value = held.reduce((a, id) => { const c = s.market.find(x => x.id === id); return a + (c ? c.price * s.stock.holds[id].qty : 0); }, 0);

  let h = `<div class="row"><h4>포트폴리오</h4>
    <div class="kv"><span>평가액</span><b class="c-gold">${won(value)}</b></div>
    <div class="meta">상장 기업만 거래할 수 있습니다. 맵에서 회사를 눌러 관심 종목으로 등록하세요.</div></div>`;

  if (held.length) h += held.map(id => {
    const c = s.market.find(x => x.id === id), hd = s.stock.holds[id];
    if (!c) return '';
    const pl = (c.price - hd.avg) * hd.qty;
    return `<div class="row tight">
      <h4>${esc(c.name)}<span class="${pl >= 0 ? 'c-jade' : 'c-blood'}" style="font-size:10px;font-family:var(--f-sm)">${pl >= 0 ? '+' : ''}${won(pl)}</span></h4>
      <div class="meta">${hd.qty.toLocaleString()}주 · 평단 ${Math.round(hd.avg).toLocaleString()} · 현재가 ${c.price.toLocaleString()}</div>
      <div class="btn-row">
        <button class="btn" data-sell="${id}" data-q="${Math.ceil(hd.qty / 2)}">절반 매도</button>
        <button class="btn blood" data-sell="${id}" data-q="${hd.qty}">전량 매도</button>
      </div></div>`;
  }).join('');

  /* 관심 등록이 시장 목록을 덮어쓰면 다른 종목을 못 본다. 서브탭으로 가른다. */
  const onWatch = STOCK_VIEW === 'watch';
  const show = onWatch ? watch : listed.slice(0, 14);
  h += `<div class="subtabs" style="margin-top:8px">
    <button class="subtab ${onWatch ? '' : 'on'}" data-sv="all">시장 전체</button>
    <button class="subtab ${onWatch ? 'on' : ''}" data-sv="watch">관심 ${watch.length}</button>
  </div>`;
  if (!show.length) h += `<div class="empty">${onWatch ? '관심 등록한 종목이 없습니다<br>시장 전체에서 등록하세요' : '상장 종목이 없습니다'}</div>`;
  h += show.map(c => {
    const prev = c.hist.length > 1 ? c.hist[c.hist.length - 2] : c.price;
    const chg = ((c.price - prev) / prev * 100);
    const q1 = Math.max(1, Math.floor(s.co.cash * 0.1 / c.price));
    return `<div class="row tight">
      <h4>${esc(c.name)}<span class="${chg >= 0 ? 'c-jade' : 'c-blood'}" style="font-size:10px;font-family:var(--f-sm)">${c.price.toLocaleString()}원 ${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(1)}%</span></h4>
      <div class="meta">${SECTORS[c.sector].name} · 시총 ${won(c.cap)}${c.curse ? ' · <span class="c-mauve">살 적중</span>' : ''}</div>
      <div class="btn-row">
        <button class="btn jade" data-buy="${c.id}" data-q="${q1}" ${q1 * c.price > s.co.cash ? 'disabled' : ''}>매수 ${q1.toLocaleString()}주</button>
        ${s.stock.watch.includes(c.id)
          ? `<button class="btn" data-unwatch="${c.id}">관심 해제</button>`
          : `<button class="btn" data-watch="${c.id}">관심 등록</button>`}
      </div></div>`;
  }).join('');

  $('panel-body').innerHTML = h;
  const R = $('panel-body');
  R.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { buyStock(s, s.market.find(c => c.id === b.dataset.buy), +b.dataset.q); renderRight(); renderHud(); });
  R.querySelectorAll('[data-sell]').forEach(b => b.onclick = () => { sellStock(s, s.market.find(c => c.id === b.dataset.sell), +b.dataset.q); renderRight(); renderHud(); });
  R.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { s.stock.watch.push(b.dataset.watch); renderRight(); });
  R.querySelectorAll('[data-unwatch]').forEach(b => b.onclick = () => {
    s.stock.watch = s.stock.watch.filter(id => id !== b.dataset.unwatch); renderRight();
  });
  R.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { STOCK_VIEW = b.dataset.sv; renderRight(); });
}

/* 무당 */
function tabShaman() {
  const s = S, hired = s.shaman.hired;
  let h = `<div class="row" style="border-color:var(--mauve)">
    <h4 class="c-mauve">무속 신뢰도</h4>
    <div class="gauge sm" style="margin-top:4px"><i style="width:${s.co.mistrust}%;background:var(--mauve)"></i><span>${Math.round(s.co.mistrust)}/100</span></div>
    <div class="meta">굿 1회당 +${BAL.gutMistrust}. ${BAL.mistrustPenaltyAt} 초과 시 협상 성공도 증가율과 굿 성공률이 함께 떨어지고, 100에 닿으면 무속 스캔들 엔딩입니다.</div>
  </div>`;

  if (hired) {
    const fee = shamanFee(s, hired);
    h += `<div class="row">
      <h4>계약 중 — ${esc(hired.name)}</h4>
      <div class="kv"><span>등급</span><b>${SHAMAN_TIERS[hired.tier].name}</b></div>
      <div class="kv"><span>굿 성공률</span><b>${Math.round((hired.rate - (s.co.mistrust > BAL.mistrustPenaltyAt ? 0.1 : 0)) * 100)}%</b></div>
      <div class="kv"><span>발각 확률</span><b class="c-blood">${Math.round(hired.expose * 100)}%</b></div>
      <div class="kv"><span>1회 비용</span><b>${won(fee)}</b></div>
      <div class="btn-row">
        <button class="btn mauve" id="bless" ${!s.nego || s.co.cash < fee ? 'disabled' : ''}>축원굿 — 자사 축복</button>
        <button class="btn" id="drop">계약 해지</button>
      </div>
      <div class="meta">살굿은 맵에서 대상 회사를 클릭해 의뢰합니다. ${!s.nego ? '축원굿은 협상 진행 중에만 의미가 있습니다.' : ''}</div>
    </div>`;
  }

  h += `<div class="row" style="margin-top:8px"><h4>섭외 가능 무당</h4>
    <div class="meta">등급이 높을수록 효과가 크지만 발각 시 타격도 큽니다.</div></div>`;
  h += s.shaman.pool.map((sh, i) => `<div class="row tight">
    <h4>${esc(sh.name)}<span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${SHAMAN_TIERS[sh.tier].name}</span></h4>
    <div><span class="stat-chip">성공 ${Math.round(sh.rate * 100)}%</span><span class="stat-chip">효과 ×${sh.power}</span><span class="stat-chip">발각 ${Math.round(sh.expose * 100)}%</span></div>
    <div class="meta">굿 1회 ${won(shamanFee(s, sh))}</div>
    <div class="btn-row"><button class="btn mauve" data-hires="${i}" ${hired?.id === sh.id ? 'disabled' : ''}>${hired?.id === sh.id ? '계약 중' : '계약'}</button></div>
  </div>`).join('');

  $('panel-body').innerHTML = h;
  const R = $('panel-body');
  R.querySelectorAll('[data-hires]').forEach(b => b.onclick = () => { s.shaman.hired = s.shaman.pool[+b.dataset.hires]; renderRight(); });
  const bl = $('bless'); if (bl) bl.onclick = () => { doGut(s, 'bless'); renderAll(); };
  const dr = $('drop'); if (dr) dr.onclick = () => { s.shaman.hired = null; renderRight(); };
}

/* 찌라시 */
function tabRumor() {
  const s = S;
  const intel = sumStat(s.staff, 'intel');
  let h = `<div class="row"><h4>찌라시 네트워크</h4>
    <div class="kv"><span>정보력 합계</span><b>${Math.round(intel)}</b></div>
    <div class="kv"><span>일일 입수 확률</span><b>${(clamp(intel * BAL.rumorChanceBase * (1 + s.staff.filter(e => e.trait.id === 'ear').length * 0.6), 0, 1) * 100).toFixed(1)}%</b></div>
    <div class="meta">정보력이 높은 직원을 고용할수록 높은 등급의 찌라시가 들어옵니다. 등급 F~S.</div></div>`;
  h += s.rumors.length ? s.rumors.map(r => `<div class="row tight" style="${r.used ? 'opacity:.5' : ''}">
      <h4><span class="c-gold">${r.grade}급</span> ${esc(r.tname)}<span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${r.day}일차</span></h4>
      <div class="meta">${esc(r.text)}</div>
      <div class="meta">사용 시 인수가 프리미엄 -${Math.round(r.val * 100)}%p${r.val >= 0.16 ? ' · 인수 난이도 1단계 하락' : ''}</div>
      ${r.used ? '<div class="meta c-dim">사용됨</div>' : `<div class="btn-row"><button class="btn gold" data-rum="${r.id}">정보 활용</button></div>`}
    </div>`).join('')
    : `<div class="row"><div class="empty">입수한 찌라시가 없습니다<br>정보력 높은 직원을 채용해보세요</div></div>`;
  $('panel-body').innerHTML = h;
  $('panel-body').querySelectorAll('[data-rum]').forEach(b => b.onclick = () => {
    useRumor(s, s.rumors.find(r => r.id === b.dataset.rum)); renderRight();
  });
}

/* 알림 */
function tabInbox() {
  const s = S;
  s.inbox.forEach(i => i.read = true);
  let h = s.inbox.length ? s.inbox.map(i => `<div class="row tight" style="border-left:5px solid ${i.kind === 'bad' ? 'var(--blood)' : i.kind === 'good' ? 'var(--jade)' : 'var(--sky)'}">
      <h4>${esc(i.title)}<span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${i.day}일차</span></h4>
      <div class="meta">${i.body}</div></div>`).join('')
    : `<div class="row"><div class="empty">알림이 없습니다</div></div>`;
  h += `<div class="row" style="margin-top:10px"><h4>뉴스 기록</h4>${
    s.log.slice(0, 20).map(l => `<div class="kv"><span class="c-dim">${l.d}일</span><b style="font-size:10px;font-family:var(--f-sm);text-align:right">${esc(l.t)}</b></div>`).join('') || '<div class="empty">없음</div>'}</div>`;
  $('panel-body').innerHTML = h;
  renderHud();
}

export { setTab, STOCK_VIEW, TAB, TABS, renderRight, rerollCost, tabInbox, tabRumor, tabShaman, tabStaff, tabStock, trainCost };
