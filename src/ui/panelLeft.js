import { BAL } from '../core/balance.js';
import { rivalOf } from '../core/rivals.js';
import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { S } from '../core/state.js';
import { divisionName, divisionsOf, isHolding, tagChips } from '../core/tags.js';
import { $, esc, pct, won } from '../core/util.js';
import { capCeiling } from '../systems/company.js';
import { NEGO_ACTS, negoAct, negoLeft } from '../systems/mna.js';
import { goalText } from '../systems/ending.js';
import { managersHave, managersNeeded, pmi, synergyParts } from '../systems/economy.js';
import { renderAll } from './index.js';
import { openModal } from './modal.js';
import { openSub } from './subPanel.js';
import { TAB } from './tabs.js';

/* ── 협상 중 능동 개입 ────────────────────────────────────
   남은 횟수는 숫자가 아니라 마름모로 낸다 (기획서 §2 원칙 3 — 새 게이지 대신
   아이콘 개수). 판정은 전부 systems/mna.js 에 있고 여기는 버튼만 그린다. */
function negoActsHtml(s, n) {
  const left = negoLeft(n);
  const pips = '◆'.repeat(left) + '◇'.repeat(Math.max(0, BAL.negoActs - left));
  const btn = ([id, a]) => {
    const cost = a.cost(s, n);
    const off = (!a.free && left <= 0) || !!a.can(s, n);
    return `<button class="btn ${a.free ? 'blood' : ''}" data-nact="${id}"
      ${off ? 'disabled' : ''} title="${a.d}${cost ? ` · 비용 ${won(cost)}` : ''}">
      ${a.n}${cost ? `<span class="c-dim" style="font-size:10px"> ${won(cost)}</span>` : ''}</button>`;
  };
  const acts = Object.entries(NEGO_ACTS);
  /* 손절(중단)은 개입이 아니라 탈출구다. 같은 줄에 두면 횟수를 먹는 것처럼 읽혀
     쓰기를 망설이게 된다. 줄을 나누고 횟수 표시에서도 뺐다. */
  return `<div class="meta" style="margin-top:7px">개입 <b class="c-gold">${pips}</b>
      — 협상 1건에 ${BAL.negoActs}회. 남은 횟수는 다음 협상으로 넘어가지 않습니다.</div>
    <div class="btn-row">${acts.filter(([, a]) => !a.free).map(btn).join('')}</div>
    <div class="btn-row">${acts.filter(([, a]) => a.free).map(btn).join('')}</div>`;
}

/* ── 회사 현황 창 ────────────────────────────────────────── */
function renderLeft() {
  if (TAB !== 'co') return;                 // 회사 창이 닫혀 있으면 그릴 곳이 없다
  const s = S, t = TIERS[s.co.tier];
  const net = s.co.revToday - s.co.costToday;
  let h = '';

  h += `<div class="row">
    <h4>${t.name}<span class="c-dim" style="font-size:10px;font-family:var(--f-sm)">${s.co.tier + 1}/${TIERS.length}</span></h4>
    <div class="gauge sm" style="margin-top:5px"><i style="width:${(s.co.tier + 1) / TIERS.length * 100}%;background:var(--gold)"></i></div>
    <div class="meta">다음 목표 — ${goalText(s)}</div>
    <div class="meta">인수 가능 규모 상한 ${capCeiling(s) === Infinity ? '무제한' : won(capCeiling(s))}</div>
  </div>`;

  h += `<div class="row">
    <h4>일일 손익</h4>
    <div class="kv"><span>매출</span><b>${won(s.co.revToday)}</b></div>
    <div class="kv"><span>비용</span><b class="c-blood">-${won(s.co.costToday)}</b></div>
    <div class="kv" style="border-top:1px solid var(--paper-3);margin-top:3px;padding-top:3px">
      <span>순익</span><b class="${net >= 0 ? 'c-jade' : 'c-blood'}">${net >= 0 ? '+' : ''}${won(net)}</b></div>
    <div class="kv"><span>인지도</span><b>×${s.co.marketing.toFixed(2)}</b></div>
    <div class="meta c-dim">인지도·발주·시설은 <b>사옥 → 매장</b> 창에서 조작합니다.</div>
  </div>`;

  if (s.nego) {
    const n = s.nego;
    h += `<div class="row" style="border-color:var(--sky)">
      <h4 class="c-sky">진행 중 M&amp;A</h4>
      <div style="font-size:12px;margin:3px 0">${esc(n.name)}</div>
      <div class="meta">난이도 ${DIFFS[n.diff].name} · 협상단 ${n.team.length}명 · 예상 웃돈 +${Math.round(n.prem * 100)}%${n.direct ? ' · 직접 협상' : ' · 위임'}</div>
      ${n.rivalDue ? `<div class="meta c-blood" style="font-size:11px" title="${rivalOf(n.id).who}">${rivalOf(n.id).n}도 접근 중 — <b>${Math.max(0, n.rivalDue - s.day)}일</b> 안에 마쳐야 합니다</div>` : ''}
      <div style="margin-top:6px;font-size:10px;font-family:var(--f-sm)">진행도</div>
      <div class="gauge"><i style="width:${n.progress}%;background:var(--sky)"></i><span>${pct(n.progress)}</span></div>
      <div style="margin-top:5px;font-size:10px;font-family:var(--f-sm)">성공도</div>
      <div class="gauge"><i style="width:${n.success}%;background:${n.success > 60 ? 'var(--jade)' : n.success > 30 ? 'var(--gold)' : 'var(--blood)'}"></i><span>${pct(n.success)}</span></div>
      <div class="meta">진행도 100% 도달 시 성공도 확률로 인수 여부가 결정됩니다.</div>
      ${negoActsHtml(s, n)}
    </div>`;
  } else {
    h += `<div class="row"><h4>진행 중 M&amp;A</h4>
      <div class="empty">없음<br>도시 맵에서 회사를 클릭해<br>협상단을 파견하세요</div></div>`;
  }

  h += `<div class="row">
    <h4>리스크</h4>
    <div style="font-size:10px;font-family:var(--f-sm);margin-top:4px">미신지수 ${Math.round(s.co.mistrust)}/100</div>
    <div class="gauge sm"><i style="width:${s.co.mistrust}%;background:var(--mauve)"></i></div>
    <div style="font-size:10px;font-family:var(--f-sm);margin-top:5px">수사 압박 ${Math.round(s.co.probe)}/100</div>
    <div class="gauge sm"><i style="width:${s.co.probe}%;background:var(--blood)"></i></div>
    <div class="meta">${s.co.mistrust > BAL.mistrustPenaltyAt ? '<b class="c-mauve">미신지수 과다 — 협상 성공도 증가율 -22%</b>' : '두 수치가 100에 닿으면 배드 엔딩으로 직행합니다.'}</div>
  </div>`;

  if (s.co.subs.length) {
    const sp = synergyParts(s), syn = s.co.synergy;
    /* 분해 항목 5줄을 상시로 띄우면 이 창에만 게이지가 6개가 된다.
       배수 하나만 남기고 내역은 툴팁으로 접는다 (기획서 §10-3 숫자 상한). */
    const part = (label, v) => v ? `${label} ${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '';
    const parts = [part('업종 집중', sp.focus), part('계열사 특성', sp.tag), part('통합 중', sp.integ),
                   part('관리 인력 부족', sp.short), part('점검', sp.audit)].filter(Boolean).join(' · ');
    h += `<div class="row" style="border-color:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}">
      <h4>그룹 운영 효율<b class="${syn >= 1 ? 'c-jade' : 'c-blood'}">×${syn.toFixed(2)}</b></h4>
      <div class="gauge sm" style="margin-top:4px" title="${parts || '내역 없음'}">
        <i style="width:${(syn - BAL.synMin) / (BAL.synMax - BAL.synMin) * 100}%;background:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}"></i>
      </div>
      <div class="meta">계열사 수익 전체에 곱해집니다.${parts ? ` <span class="c-dim">(${parts})</span>` : ''}</div>
      <div class="kv"><span>관리 인력</span><b class="${managersHave(s) < managersNeeded(s) ? 'c-blood' : ''}">${managersHave(s)} / ${managersNeeded(s)}명 필요</b></div>
      <div class="meta">사업부 점검은 <b>사옥 → 매장 → 운영</b> 에서 실행합니다.</div>
    </div>`;
    const divs = divisionsOf(s);
    if (divs.length) {
      h += `<div class="row" style="border-color:var(--gold)">
        <h4 class="c-gold">사업부 ${divs.length}${isHolding(s) ? ' <b class="c-gold">그룹 본사</b>' : ''}</h4>
        ${divs.map(k => `<div class="kv"><span>${divisionName(k)}</span><b class="c-jade">효과 2배</b></div>`).join('')}
        <div class="meta">같은 업종 계열사 3개면 결성됩니다. 사업부 5개면 그룹 본사가 섭니다.</div>
      </div>`;
    }
    h += `<div class="row"><h4>계열사 ${s.co.subs.length}</h4>${
      s.co.subs.map(c => {
        const p = Math.round(pmi(s, c) * 100);
        const chips = tagChips(c);
        return `<div class="kv sub-row" data-sub="${c.id}" style="cursor:pointer">
          <span>${esc(c.name)}${chips ? ` <span style="font-size:10px">${chips}</span>` : ''}</span>
          <b class="c-dim">${SECTORS[c.sector].name} ${won(c.cap)}${
            c.restruct ? ' <span class="c-gold">재편 중</span>' : p < 100 ? ` <span class="c-blood">통합 ${p}%</span>` : ''}</b>
        </div>`;
      }).join('')}
      <div class="meta">계열사를 누르면 투자 · 재편 · 매각을 할 수 있습니다.</div></div>`;
  }

  $('panel-body').innerHTML = h;

  $('panel-body').querySelectorAll('[data-nact]').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.nact;
      // 중단만 되돌릴 수 없다. 위약금을 보여주고 한 번 묻는다
      if (id === 'quit') {
        const fee = NEGO_ACTS.quit.cost(S, S.nego);
        return openModal({
          title: '협상 중단',
          body: `<p><b>${esc(S.nego.name)}</b> 인수 협상을 중단합니다. 협상단이 즉시 복귀해 다른 매물에 파견할 수 있습니다.</p>
                 <div class="kv" style="margin-top:10px"><span>위약금</span><b class="c-blood">${won(fee)}</b></div>`,
          choices: [{ label: `중단하고 위약금을 낸다 — ${won(fee)}`,
                      run: () => { negoAct(S, 'quit'); renderAll(); } },
                    { label: '계속 진행한다' }],
        });
      }
      if (negoAct(S, id)) renderAll();
    };
  });

  $('panel-body').querySelectorAll('[data-sub]').forEach(el => {
    el.onclick = () => {
      const c = S.co.subs.find(x => x.id === el.dataset.sub);
      if (c) openSub(c);
    };
  });
}



export { renderLeft };
