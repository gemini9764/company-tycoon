import { SECTORS, SECTOR_KEYS } from '../core/data.js';
import { S } from '../core/state.js';
import { PERK_TEXT, SUB_TAGS, hasTag, tagChips, tagsOf } from '../core/tags.js';
import { esc, won } from '../core/util.js';
import { pmi } from '../systems/economy.js';
import { canSellSub, investCost, investSub, restructCost, restructSub, sellSub, subSellValue } from '../systems/subs.js';
import { renderAll } from './index.js';
import { openModal } from './modal.js';

/* ══════════════════════════════════════════════════════════════
   계열사 상세 — 회사 창의 계열사 목록에서 클릭하면 열린다.

   **새 창을 만들지 않는다.** 지금 창이 8개고 여기서 더 늘리면 독이 넘친다.
   모달 하나로 끝내고, 업종 전환만 모달을 한 겹 더 쌓는다.
   ══════════════════════════════════════════════════════════════ */

function openSub(c) {
  const s = S;
  const p = Math.round(pmi(s, c) * 100);
  const sell = subSellValue(s, c);
  const sellWhy = canSellSub(s, c);
  const inv = investCost(s, c);
  const res = restructCost(s, c);
  const chips = tagChips(c);

  const gain = sell - (c.paid || 0);   // 인수가를 기억해 두면 손익이 보인다

  openModal({
    title: `${c.name} — ${SECTORS[c.sector].name}`,
    body: `
      <div class="kv"><span>시가총액</span><b>${won(c.cap)}</b></div>
      <div class="kv"><span>통합</span><b class="${p < 100 ? 'c-blood' : 'c-jade'}">${p}%</b></div>
      ${c.paid ? `<div class="kv"><span>인수가</span><b class="c-dim">${won(c.paid)}</b></div>` : ''}
      ${chips ? `<div class="kv"><span>특성</span><b>${chips}</b></div>` : ''}
      <div class="kv"><span>업종 효과</span><b class="c-dim">${PERK_TEXT[c.sector]}</b></div>
      ${c.restruct ? `<p style="margin-top:10px" class="c-gold">
        ${SECTORS[c.restruct.to].name} 업종으로 재편 중 — ${c.restruct.until - s.day}일 남음.
        기간 중에는 이 계열사에서 수익이 나지 않습니다.</p>` : ''}
      ${hasTag(c, 'union') ? '<p style="margin-top:8px;font-size:12px" class="c-blood">강성 노조 — 관리 인력을 2명분 먹습니다.</p>' : ''}
      ${hasTag(c, 'patent') ? `<p style="margin-top:8px;font-size:12px" class="c-jade">특허 보유 — ${SECTORS[c.sector].name} 계열사 전체 수익 +10%.</p>` : ''}
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:8px;padding-top:6px">
        <span>지금 매각하면</span><b class="c-gold">${won(sell)}</b></div>
      ${c.paid ? `<div class="kv"><span>인수가 대비</span><b class="${gain >= 0 ? 'c-jade' : 'c-blood'}">${gain >= 0 ? '+' : '-'}${won(Math.abs(gain))}</b></div>` : ''}`,
    choices: [
      {
        label: `투자 — ${won(inv)}`,
        sub: curedLine(c),
        dis: s.co.cash < inv || !!c.restruct,
        run: () => { investSub(s, c); renderAll(); },
      },
      {
        label: `사업 재편 — ${won(res)}`,
        sub: '업종을 바꿉니다 · 기간 중 수익 0',
        dis: s.co.cash < res || !!c.restruct,
        run: () => openRestruct(c),
      },
      {
        label: `매각 — ${won(sell)}`,
        sub: sellWhy || (pmi(s, c) < 1 ? '통합 전이라 제값을 못 받습니다' : '시장에 다시 매물로 나옵니다'),
        dis: !!sellWhy,
        run: () => confirmSell(c, sell),
      },
      { label: '닫기', run: () => {} },
    ],
  });
}

/** 투자 버튼 아래 한 줄 — 고칠 태그가 있으면 그걸 앞세운다 */
function curedLine(c) {
  const k = tagsOf(c).find(x => SUB_TAGS[x].curable);
  return k ? `${SUB_TAGS[k].n} 해소 · 시총 +12%` : '시가총액 +12%';
}

function confirmSell(c, v) {
  openModal({
    title: '계열사 매각',
    body: `<p><b>${esc(c.name)}</b>을(를) <b class="c-gold">${won(v)}</b>에 매각합니다.</p>
           <p style="margin-top:8px;font-size:12px" class="c-dim">매각한 회사는 시장에 다시 매물로 나옵니다. 되사려면 협상을 처음부터 다시 해야 합니다.</p>`,
    choices: [
      { label: '매각한다', run: () => { sellSub(S, c); renderAll(); } },
      { label: '그만둔다', run: () => {} },
    ],
  });
}

function openRestruct(c) {
  const s = S;
  openModal({
    title: `${c.name} — 업종 전환`,
    body: `<p>현재 <b>${SECTORS[c.sector].name}</b>. 전환할 업종을 고르세요.</p>
           <p style="margin-top:8px;font-size:12px" class="c-dim">같은 업종 계열사가 3개가 되면 사업부가 결성되어 그 업종 효과가 2배가 됩니다.</p>`,
    choices: [
      ...SECTOR_KEYS.filter(k => k !== c.sector).map(k => ({
        label: SECTORS[k].name,
        sub: `${PERK_TEXT[k]} · 현재 ${s.co.subs.filter(x => x.sector === k).length}개`,
        run: () => { restructSub(s, c, k); renderAll(); },
      })),
      { label: '그만둔다', run: () => {} },
    ],
  });
}

export { openSub };
