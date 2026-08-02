import { sfx } from '../core/audio.js';
import { BAL } from '../core/balance.js';
import { S } from '../core/state.js';
import { $, clamp, won } from '../core/util.js';
import { FACIL, facLv, facilCost, facilLocked, invCost, invLife, managersHave, managersNeeded, orderInv, retailPotential, synergyParts } from '../systems/economy.js';
import { renderHud } from './hud.js';
import { TAB } from './tabs.js';
import { toast } from './toast.js';

/* ══════════════════════════════════════════════════════════════
   매장 창 — 사옥 모드 전용

   전에는 광고·점검이 '회사' 창에 있었는데, 그 창이 도시 전용이 되면서
   사옥에서 누를 수 있는 경영 조작이 하나도 없었다. 경영하는 행위는 전부
   이쪽으로 모은다. '회사' 창은 조회 전용으로 남는다.

   서브탭 셋 — 발주 / 시설 / 운영.
   ══════════════════════════════════════════════════════════════ */
let SHOP_VIEW = 'order';

const ORDER_STEPS = [25, 50, 100];

/** 인지도 광고 단가 — 규모를 따라간다 */
const adCost = (s, mul) => Math.round(Math.max(3e5, retailPotential(s) * 1.6) * mul);

const auditCost = s => Math.round(Math.max(3e6, s.co.subs.reduce((a, c) => a + c.cap, 0) * 0.004));

function renderShop() {
  if (TAB !== 'shop') return;                  // 창이 닫혀 있으면 그릴 곳이 없다
  const s = S;
  const h = `<div class="subtabs">
      ${[['order', '발주'], ['facil', '시설'], ['ops', '운영']].map(([k, n]) =>
        `<button class="subtab ${SHOP_VIEW === k ? 'on' : ''}" data-sv="${k}">${n}</button>`).join('')}
    </div>` + ({ order: viewOrder, facil: viewFacil, ops: viewOps })[SHOP_VIEW](s);

  $('panel-body').innerHTML = h;
  bind(s);
}

/* ── 발주 ────────────────────────────────────────────────── */
function viewOrder(s) {
  const st = Math.round(s.co.inv ?? 100);
  const col = st < BAL.invWarnAt ? 'var(--blood)' : st < 60 ? 'var(--gold)' : 'var(--jade)';
  const daysLeft = Math.floor(st / (100 / invLife(s)));
  return `<div class="row" style="border-color:${col}">
      <h4>재고<b style="color:${col}">${st}%</b></h4>
      <div class="gauge" style="margin-top:4px"><i style="width:${st}%;background:${col}"></i><span>${st} / 100</span></div>
      <div class="meta">재고가 바닥나면 매출이 최대 ${Math.round((1 - BAL.invFloor) * 100)}% 까지 빠집니다.
        지금 속도로 <b>${daysLeft}일</b> 뒤 소진 (만재 기준 ${invLife(s)}일).</div>
      <div class="btn-row">
        ${ORDER_STEPS.map(p => {
          const room = Math.max(0, 100 - st), want = Math.min(p, room);
          const c = invCost(s, want);
          return `<button class="btn gold" data-order="${p}" ${!want || c > s.co.cash ? 'disabled' : ''}>
            ${p === 100 ? '가득' : '+' + p + '%'} ${won(c)}</button>`;
        }).join('')}
      </div>
      <div class="meta">한 번에 50% 이상 채우면 단가 ${Math.round(BAL.invBulkOff * 100)}% 할인.</div>
    </div>
    <div class="row">
      <h4>자동 발주<b class="${s.co.autoOrder ? 'c-jade' : 'c-dim'}">${s.co.autoOrder ? '켜짐' : '꺼짐'}</b></h4>
      <div class="meta">매일 소모분을 자동으로 채웁니다. 손이 덜 가는 대신 단가가
        ${Math.round(BAL.invAutoUp * 100)}% 비쌉니다.</div>
      <div class="btn-row"><button class="btn ${s.co.autoOrder ? '' : 'jade'} wide" id="shop-auto">
        ${s.co.autoOrder ? '자동 발주 끄기' : '자동 발주 켜기'}</button></div>
    </div>`;
}

/* ── 시설 ────────────────────────────────────────────────── */
function viewFacil(s) {
  return Object.keys(FACIL).map(k => {
    const f = FACIL[k], lv = facLv(s, k), max = lv >= f.max, lock = facilLocked(s, k);
    const cost = facilCost(s, k);
    return `<div class="row">
      <h4>${f.n}<b class="${lv ? 'c-gold' : 'c-dim'}">Lv.${lv} / ${f.max}</b></h4>
      <div class="gauge sm" style="margin-top:4px"><i style="width:${lv / f.max * 100}%;background:var(--gold)"></i></div>
      <div class="meta">${f.d}</div>
      <div class="btn-row">
        <button class="btn gold" data-fac="${k}" ${max || lock || cost > s.co.cash ? 'disabled' : ''}>
          ${max ? '최대' : lock ? `${['구멍가게', '동네슈퍼', '스타트업'][f.tier]} 등급부터` : `증설 ${won(cost)}`}</button>
      </div>
    </div>`;
  }).join('');
}

/* ── 운영 ────────────────────────────────────────────────── */
function viewOps(s) {
  const syn = s.co.synergy, sp = synergyParts(s);
  let h = `<div class="row">
      <h4>인지도<b>×${s.co.marketing.toFixed(2)}</b></h4>
      <div class="gauge sm" style="margin-top:4px"><i style="width:${s.co.marketing / BAL.marketingCap * 100}%;background:var(--gold)"></i></div>
      <div class="meta">손님 수와 매출에 곱해집니다. 매일 조금씩 떨어지므로 꾸준히 올려야 합니다. 상한 ×${BAL.marketingCap}</div>
      <div class="btn-row">
        <button class="btn gold" id="ad-s" ${adCost(s, 1) > s.co.cash ? 'disabled' : ''}>전단지 ${won(adCost(s, 1))}</button>
        <button class="btn gold" id="ad-l" ${adCost(s, 3) > s.co.cash ? 'disabled' : ''}>광고 캠페인 ${won(adCost(s, 3))}</button>
      </div>
    </div>`;

  if (s.co.subs.length) {
    h += `<div class="row" style="border-color:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}">
      <h4>그룹 운영 효율<b class="${syn >= 1 ? 'c-jade' : 'c-blood'}">×${syn.toFixed(2)}</b></h4>
      <div class="gauge sm" style="margin-top:4px">
        <i style="width:${(syn - BAL.synMin) / (BAL.synMax - BAL.synMin) * 100}%;background:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}"></i></div>
      <div class="meta">계열사 수익 전체에 곱해집니다. 목표 ×${sp.target.toFixed(2)}로 서서히 수렴합니다.</div>
      <div class="kv"><span>관리 인력</span><b class="${managersHave(s) < managersNeeded(s) ? 'c-blood' : ''}">${managersHave(s)} / ${managersNeeded(s)}명 필요</b></div>
      <div class="btn-row">
        <button class="btn jade" id="audit" ${s.co.auditBuff >= BAL.auditCap || auditCost(s) > s.co.cash ? 'disabled' : ''}>사업부 점검 ${won(auditCost(s))}</button>
      </div>
      <div class="meta">${s.co.auditBuff >= BAL.auditCap ? '점검 효과가 최대입니다.' : '현장 점검으로 효율을 끌어올립니다. 효과는 시간이 지나면 옅어집니다.'}</div>
    </div>`;
  } else {
    h += '<div class="empty">계열사를 인수하면 그룹 운영 항목이 열립니다</div>';
  }
  return h;
}

/* ── 조작 ────────────────────────────────────────────────── */
function bind(s) {
  const R = $('panel-body');
  R.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { SHOP_VIEW = b.dataset.sv; renderShop(); });

  R.querySelectorAll('[data-order]').forEach(b => b.onclick = () => {
    const got = orderInv(s, +b.dataset.order, false);
    if (!got) return toast('자금이 부족합니다', 'bad');
    sfx('coin'); toast(`재고 +${got}%`, 'good');
    renderShop(); renderHud();
  });

  const auto = $('shop-auto');
  if (auto) auto.onclick = () => {
    s.co.autoOrder = !s.co.autoOrder;
    toast(s.co.autoOrder ? '자동 발주를 켰습니다' : '자동 발주를 껐습니다', s.co.autoOrder ? 'good' : '');
    renderShop();
  };

  R.querySelectorAll('[data-fac]').forEach(b => b.onclick = () => {
    const k = b.dataset.fac, c = facilCost(s, k);
    if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c;
    s.co.facil[k] = facLv(s, k) + 1;
    sfx('coin'); toast(`${FACIL[k].n} Lv.${s.co.facil[k]}`, 'good');
    renderShop(); renderHud();
  });

  const ad = mul => {
    const c = adCost(s, mul);
    if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c;
    s.co.marketing = clamp(s.co.marketing + 0.12 * mul, 0, BAL.marketingCap);
    sfx('coin'); toast(`인지도 +${(0.12 * mul).toFixed(2)}`, 'good');
    renderShop(); renderHud();
  };
  if ($('ad-s')) $('ad-s').onclick = () => ad(1);
  if ($('ad-l')) $('ad-l').onclick = () => ad(3);

  const au = $('audit');
  if (au) au.onclick = () => {
    const c = auditCost(s);
    if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c;
    s.co.auditBuff = clamp((s.co.auditBuff || 0) + BAL.auditGain, 0, BAL.auditCap);
    sfx('coin'); toast(`운영 효율 목표 +${Math.round(BAL.auditGain * 100)}%`, 'good');
    renderShop(); renderHud();
  };
}

export { ORDER_STEPS, SHOP_VIEW, adCost, auditCost, renderShop, viewFacil, viewOps, viewOrder };
