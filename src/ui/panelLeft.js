import { BAL } from '../core/balance.js';
import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { S } from '../core/state.js';
import { $, esc, pct, won } from '../core/util.js';
import { capCeiling } from '../systems/company.js';
import { goalText } from '../systems/ending.js';
import { managersHave, managersNeeded, pmi, synergyParts } from '../systems/economy.js';
import { TAB } from './tabs.js';

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
      <div class="meta">난이도 ${DIFFS[n.diff].name} · 협상단 ${n.team.length}명 · 예상 프리미엄 +${Math.round(n.prem * 100)}%</div>
      <div style="margin-top:6px;font-size:10px;font-family:var(--f-sm)">진행도</div>
      <div class="gauge"><i style="width:${n.progress}%;background:var(--sky)"></i><span>${pct(n.progress)}</span></div>
      <div style="margin-top:5px;font-size:10px;font-family:var(--f-sm)">성공도</div>
      <div class="gauge"><i style="width:${n.success}%;background:${n.success > 60 ? 'var(--jade)' : n.success > 30 ? 'var(--gold)' : 'var(--blood)'}"></i><span>${pct(n.success)}</span></div>
      <div class="meta">진행도 100% 도달 시 성공도 확률로 인수 여부가 결정됩니다.</div>
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
    const line = (label, v) => v ? `<div class="kv"><span>${label}</span><b class="${v > 0 ? 'c-jade' : 'c-blood'}">${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%</b></div>` : '';
    h += `<div class="row" style="border-color:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}">
      <h4>그룹 운영 효율<b class="${syn >= 1 ? 'c-jade' : 'c-blood'}">×${syn.toFixed(2)}</b></h4>
      <div class="gauge sm" style="margin-top:4px">
        <i style="width:${(syn - BAL.synMin) / (BAL.synMax - BAL.synMin) * 100}%;background:${syn >= 1 ? 'var(--jade)' : 'var(--blood)'}"></i>
      </div>
      <div class="meta">계열사 수익 전체에 곱해집니다. 목표 ×${sp.target.toFixed(2)}로 서서히 수렴합니다.</div>
      ${line('업종 집중', sp.focus)}${line('통합 진행 중', sp.integ)}${line('관리 인력 부족', sp.short)}${line('점검 효과', sp.audit)}
      <div class="kv"><span>관리 인력</span><b class="${managersHave(s) < managersNeeded(s) ? 'c-blood' : ''}">${managersHave(s)} / ${managersNeeded(s)}명 필요</b></div>
      <div class="meta">사업부 점검은 <b>사옥 → 매장 → 운영</b> 에서 실행합니다.</div>
    </div>`;
    h += `<div class="row"><h4>계열사 ${s.co.subs.length}</h4>${
      s.co.subs.map(c => {
        const p = Math.round(pmi(s, c) * 100);
        return `<div class="kv"><span>${esc(c.name)}</span><b class="c-dim">${SECTORS[c.sector].name} ${won(c.cap)}${p < 100 ? ` <span class="c-blood">통합 ${p}%</span>` : ''}</b></div>`;
      }).join('')}</div>`;
  }

  $('panel-body').innerHTML = h;
}



export { renderLeft };
