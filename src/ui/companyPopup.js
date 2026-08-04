import { BAL } from '../core/balance.js';
import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { sumStat, teamOf } from '../core/derive.js';
import { S } from '../core/state.js';
import { $, won } from '../core/util.js';
import { loanLimit } from '../systems/bank.js';
import { capCeiling, loanRate, teamPower } from '../systems/company.js';
import { startNego } from '../systems/mna.js';
import { useRumor } from '../systems/rumor.js';
import { doGut, shamanFee } from '../systems/shaman.js';
import { renderAll } from './index.js';
import { openModal } from './modal.js';
import { setTab, TAB } from './tabs.js';
import { toast } from './toast.js';

/* ── 회사 상세 팝업 (맵 클릭) ────────────────────────────── */
function openCompany(c) {
  const s = S, d = DIFFS[c.diff], overCap = c.cap > capCeiling(s);
  const rumor = s.rumors.find(r => r.target === c.id && !r.used);
  // 협상 시작 전에 자금 그림을 보여줘야 '빚을 내서라도 인수할지'가 선택지로 보인다
  const est = Math.round(c.cap * (1 + Math.max(0.02, d.prem - sumStat(teamOf(s), 'intel') * 0.0016)));
  const short = Math.max(0, est - s.co.cash);
  const finLimit = loanLimit(s, 'acq', est);
  openModal({
    title: `${c.name} — ${SECTORS[c.sector].name}`,
    body: `
      <div class="kv"><span>시가총액</span><b>${won(c.cap)}</b></div>
      <div class="kv"><span>인수 난이도</span><b>${d.name}${(c.diff0 ?? c.diff) > c.diff ? ` <span class="c-jade">(원래 ${DIFFS[c.diff0].name})</span>` : ''}</b></div>
      <div class="kv"><span>예상 프리미엄</span><b>+${Math.round(d.prem * 100)}%</b></div>
      <div class="kv"><span>상장 여부</span><b>${c.listed ? '상장 · ' + c.price.toLocaleString() + '원' : '비상장'}</b></div>
      ${c.owned ? '' : `
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:6px;padding-top:6px">
        <span>예상 인수가</span><b class="c-gold">${won(est)}</b></div>
      <div class="kv"><span>보유 자금</span><b class="${short ? 'c-blood' : 'c-jade'}">${won(s.co.cash)}</b></div>
      ${short ? `<p style="margin-top:8px;font-size:12px">자금이 <b class="c-blood">${won(short)}</b> 모자랍니다. 그래도 협상은 시작할 수 있고, 성사 시점에 <b>인수금융</b>으로 메울 수 있습니다 — 한도 ${won(finLimit)}, 금리 ${loanRate(s, 'acq').toFixed(1)}%. 인수 기업이 담보라 상환에 실패하면 압류됩니다.</p>`
              : '<p style="margin-top:8px;font-size:12px" class="c-jade">자기자금으로 지불할 수 있습니다.</p>'}` }
      ${c.owned ? '<p style="margin-top:10px" class="c-jade">이미 우리 그룹 계열사입니다.</p>' : ''}
      ${overCap ? `<p style="margin-top:10px" class="c-blood">현재 등급(${TIERS[s.co.tier].name})으로는 인수할 수 없는 규모입니다. 상한 ${won(capCeiling(s))}</p>` : ''}
      ${c.curse ? '<p style="margin-top:10px" class="c-mauve">살(煞)이 걸려 있습니다 — 협상 성공도 증가율 +45%</p>' : ''}
      ${rumor ? `<p style="margin-top:10px" class="c-sky">보유 찌라시 ${rumor.grade}급 — 사용 시 인수가 -${Math.round(rumor.val * 100)}%p</p>` : ''}`,
    choices: c.owned ? [] : [
      { label: '협상단 파견', dis: !!s.nego || overCap || !teamOf(s).length,
        sub: s.nego ? '이미 진행 중인 협상이 있습니다'
             : !teamOf(s).length ? '협상단에 배정된 직원이 없습니다'
             : `협상단 ${teamOf(s).length}명 · 협상력 ${Math.round(teamPower(s))} · 약 ${Math.ceil(100 / BAL.negoProgressPerDay)}일 소요${short ? ' · 성사 시 대출 필요' : ''}`,
        run: () => { startNego(s, c); renderAll(); } },
      ...(rumor ? [{ label: `${rumor.grade}급 찌라시 사용`, sub: rumor.text, run: () => { useRumor(s, rumor); renderAll(); } }] : []),
      ...(c.listed ? [{ label: '주식 관심 등록', sub: '주식 탭 즐겨찾기에 추가',
        run: () => { if (!s.stock.watch.includes(c.id)) s.stock.watch.push(c.id); setTab('stock'); toast('관심 종목 등록', 'good'); } }] : []),
      ...(s.shaman.hired ? [{ label: '살굿 의뢰', sub: `${s.shaman.hired.name} · ${won(shamanFee(s, s.shaman.hired))} · 성공률 ${Math.round(s.shaman.hired.rate * 100)}% · 발각 ${Math.round(s.shaman.hired.expose * 100)}%`,
        run: () => { doGut(s, 'sal', c.id); renderAll(); } }] : []),
    ],
  });
}

export { openCompany };
