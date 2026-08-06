import { BAL } from '../core/balance.js';
import { DIFFS, SECTORS, TIERS } from '../core/data.js';
import { sumStat, teamOf } from '../core/derive.js';
import { S } from '../core/state.js';
import { hasHidden, tagChips } from '../core/tags.js';
import { $, won } from '../core/util.js';
import { loanLimit } from '../systems/bank.js';
import { capCeiling, loanRate, teamPower } from '../systems/company.js';
import { startNego } from '../systems/mna.js';
import { useRumor } from '../systems/rumor.js';
import { doGut, shamanFee } from '../systems/shaman.js';
import { sellStock } from '../systems/stock.js';
import { privAmt, sellPrivStake, stakeStars, staking, toggleStake } from '../systems/stock.js';
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
  const stars = stakeStars(s, c), held = s.stock.holds[c.id], priv = privAmt(s, c);
  openModal({
    title: `${c.name} — ${SECTORS[c.sector].name}`,
    body: `
      <div class="kv" title="${c.listed ? '상장 · 주가 ' + c.price.toLocaleString() + '원' : '비상장'}">
        <span>시가총액</span><b>${won(c.cap)}</b></div>
      <div class="kv"><span>인수 난이도</span><b>${d.name}${(c.diff0 ?? c.diff) > c.diff ? ` <span class="c-jade">(원래 ${DIFFS[c.diff0].name})</span>` : ''}</b></div>
      ${tagChips(c) || hasHidden(c) ? `<div class="kv"><span>특성</span><b>${tagChips(c)}${
        hasHidden(c) ? `${tagChips(c) ? ' · ' : ''}<span class="c-dim">???</span>` : ''}</b></div>` : ''}
      ${c.owned ? '' : `
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:6px;padding-top:6px"
        title="시가총액에 웃돈 +${Math.round(d.prem * 100)}%가 붙은 값입니다">
        <span>예상 인수가</span><b class="c-gold">${won(est)}</b></div>
      <div class="kv"><span>보유 자금</span><b class="${short ? 'c-blood' : 'c-jade'}">${won(s.co.cash)}</b></div>
      ${short ? `<p style="margin-top:8px;font-size:12px" title="한도 ${won(finLimit)} · 금리 ${loanRate(s, 'acq').toFixed(1)}%">자금이 <b class="c-blood">${won(short)}</b> 모자랍니다. 협상은 시작할 수 있고, 성사 시점에 <b>인수 대출</b>로 메울 수 있습니다 — 인수한 회사가 담보라 갚지 못하면 넘어갑니다.</p>`
              : '<p style="margin-top:8px;font-size:12px" class="c-jade">자기자금으로 지불할 수 있습니다.</p>'}` }
      ${c.owned ? '<p style="margin-top:10px" class="c-jade">이미 우리 그룹 계열사입니다.</p>' : ''}
      ${overCap ? `<p style="margin-top:10px" class="c-blood">현재 등급(${TIERS[s.co.tier].name})으로는 인수할 수 없는 규모입니다. 상한 ${won(capCeiling(s))}</p>` : ''}
      ${stars || priv ? `<div class="kv"><span>사둔 지분</span><b class="c-gold">${'★'.repeat(stars)}${'☆'.repeat(BAL.stakeStars - stars)}${priv ? ` <span class="c-dim">장외 ${won(priv)}</span>` : ''}</b></div>` : ''}
      ${c.leak ? '<p style="margin-top:10px" class="c-blood">지분을 사 모으는 것이 알려졌습니다 — 주가가 오르고 난이도가 한 단계 올라갔습니다.</p>' : ''}
      ${c.rivalOwned ? '<p style="margin-top:10px" class="c-blood">한 번 다른 그룹에 넘어간 회사입니다 — 값이 오르고 난이도가 한 단계 높습니다.</p>' : ''}
      ${c.curse ? '<p style="margin-top:10px" class="c-mauve">살(煞)이 걸려 있습니다 — 협상 성공도 증가율 +45%</p>' : ''}
      ${rumor ? `<p style="margin-top:10px" class="c-sky">보유 찌라시 ${rumor.grade}급 — 사용 시 인수가 -${Math.round(rumor.val * 100)}%p</p>` : ''}`,
    /* 선택지를 **밑작업 / 파견** 두 단으로 가른다. 셋이 평면으로 섞여 있으면
       살굿만 쓰고 나머지를 잊는다 — "협상 전 준비"라는 층이 UI 만으로 생긴다. */
    choices: c.owned ? [] : [
      { head: '밑작업 — 협상 전에 깔아 두는 것',
        label: `이 회사 ${c.listed ? '주식' : '지분'} 조금씩 사둔다  ${'★'.repeat(stars)}${'☆'.repeat(BAL.stakeStars - stars)}`,
        sub: staking(s, c)
             ? `사는 중 · 하루 ${won(c.cap * BAL.stakeStep)} · ★ 1칸당 성공도 +${BAL.stakeSuccess}, 인수가 -${Math.round(BAL.stakePrem * 100)}%p · ★★에서 장부가 보입니다`
             : `하루 ${won(c.cap * BAL.stakeStep)}씩 자동으로 나갑니다 · ★★★을 넘기면 소문이 납니다${c.listed ? '' : ' · 비상장이라 조금씩 사 모읍니다'}`,
        run: () => { toggleStake(s, c); renderAll(); } },
      ...(held ? [{ label: '사둔 주식을 되판다', sub: `${held.qty.toLocaleString()}주 · 지금 ${won(held.qty * c.price)}`,
        run: () => { sellStock(s, c, held.qty); renderAll(); } }] : []),
      ...(priv ? [{ label: '사둔 지분을 되판다',
        sub: `투입 ${won(priv)} · 회수 ${won(Math.round(priv * BAL.stakePrivSell))} — 비상장이라 제값을 못 받습니다`,
        run: () => { sellPrivStake(s, c); renderAll(); } }] : []),
      ...(rumor ? [{ label: `${rumor.grade}급 찌라시 사용`, sub: rumor.text,
        run: () => { useRumor(s, rumor); renderAll(); } }] : []),
      ...(s.shaman.hired ? [{ label: '살굿 의뢰', sub: `${s.shaman.hired.name} · ${won(shamanFee(s, s.shaman.hired))} · 성공률 ${Math.round(s.shaman.hired.rate * 100)}% · 발각 ${Math.round(s.shaman.hired.expose * 100)}%`,
        run: () => { doGut(s, 'sal', c.id); renderAll(); } }] : []),
      ...(c.listed ? [{ label: '주식 관심 등록', sub: '주식 탭 즐겨찾기에 추가',
        run: () => { if (!s.stock.watch.includes(c.id)) s.stock.watch.push(c.id); setTab('stock'); toast('관심 종목 등록', 'good'); } }] : []),
      /* 파견을 두 갈래로 가른다. **위임에 페널티는 없다** — 있으면 '항상 직접'이
         정답이 되어 선택이 사라진다. 트레이드오프는 시간 대 성과다. */
      { head: '준비가 끝나면', label: '협상단 파견 — 직접 협상한다',
        dis: !!s.nego || overCap || !teamOf(s).length,
        sub: s.nego ? '이미 진행 중인 협상이 있습니다'
             : !teamOf(s).length ? '협상단에 배정된 직원이 없습니다'
             : '막판에 협상 테이블이 한 판 열립니다 · 잘 두면 성공도와 인수가가 함께 좋아집니다',
        run: () => { startNego(s, c, true); renderAll(); } },
      { label: '협상단 파견 — 맡긴다', dis: !!s.nego || overCap || !teamOf(s).length,
        sub: s.nego ? '이미 진행 중인 협상이 있습니다'
             : !teamOf(s).length ? '협상단에 배정된 직원이 없습니다'
             : `협상단 ${teamOf(s).length}명 · 협상력 ${Math.round(teamPower(s))} · 약 ${Math.ceil(100 / BAL.negoProgressPerDay)}일 소요${short ? ' · 성사 시 대출 필요' : ''}`,
        run: () => { startNego(s, c); renderAll(); } },
    ],
  });
}

export { openCompany };
