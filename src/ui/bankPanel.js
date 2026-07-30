import { BAL } from '../core/balance.js';
import { debtTotal } from '../core/derive.js';
import { S } from '../core/state.js';
import { $, esc, won } from '../core/util.js';
import { loanLimit, repayLoan, takeLoan } from '../systems/bank.js';
import { creditName, loanRate } from '../systems/company.js';
import { completeAcq } from '../systems/mna.js';
import { renderAll } from './index.js';
import { openModal } from './modal.js';
import { renderRight } from './tabs.js';
import { news, toast } from './toast.js';

/* 은행 */
function tabBank() {
  const s = S, limit = loanLimit(s, 'op'), rate = loanRate(s, 'op');
  const insFee = Math.round(s.co.cap * BAL.insuranceRate);
  let h = `<div class="row">
    <h4>신용 평가</h4>
    <div class="kv"><span>신용 등급</span><b>${creditName(s)}</b></div>
    <div class="kv"><span>기준 금리</span><b>${(BAL.baseRate + (s.bank.rateDelta_ || 0)).toFixed(2)}%</b></div>
    <div class="kv"><span>운영자금 금리</span><b>${rate.toFixed(2)}%</b></div>
    <div class="kv"><span>부채비율</span><b class="${debtTotal(s) / Math.max(1, s.co.cap) > 0.6 ? 'c-blood' : ''}">${Math.round(debtTotal(s) / Math.max(1, s.co.cap) * 100)}%</b></div>
    <div class="kv"><span>연체</span><b class="${s.bank.overdue ? 'c-blood' : 'c-dim'}">${s.bank.overdue}회 / 3회 시 파산</b></div>
    <div class="btn-row">
      <button class="btn" id="donate">기부 ${won(donateCost(s))} — 신용 +</button>
    </div>
  </div>`;

  h += `<div class="row"><h4>운영 자금 대출</h4>
    <div class="kv"><span>가용 한도</span><b class="c-gold">${won(limit)}</b></div>
    <div class="meta">${BAL.loanTermMonths}개월 원리금 균등 자동 상환. 잔고 부족 시 연체 처리됩니다.</div>
    <div class="btn-row">
      ${[0.3, 0.6, 1].map(f => `<button class="btn gold" data-loan="${Math.round(limit * f)}" ${limit * f < 1e6 ? 'disabled' : ''}>${won(limit * f)}</button>`).join('')}
    </div></div>`;

  if (s.bank.loans.length) h += s.bank.loans.map((l, i) => `<div class="row tight">
    <h4>${l.kind === 'acq' ? '인수금융' : '운영자금'}<span style="font-size:9px" class="c-dim">${l.months}개월 남음</span></h4>
    <div class="kv"><span>잔액</span><b class="c-blood">${won(l.left)}</b></div>
    <div class="kv"><span>월 상환액</span><b>${won(l.due)} · ${l.rate.toFixed(2)}%</b></div>
    ${l.collateral ? `<div class="meta">담보 — ${esc(l.collateral)} (상환 실패 시 압류)</div>` : ''}
    <div class="btn-row"><button class="btn" data-repay="${i}" ${s.co.cash < l.left ? 'disabled' : ''}>일시 상환</button></div>
  </div>`).join('');
  else h += `<div class="row"><div class="empty">보유 대출 없음</div></div>`;

  h += `<div class="row"><h4>파산 방어 보험</h4>
    <div class="kv"><span>월 보험료</span><b>${won(insFee)}</b></div>
    <div class="kv"><span>상태</span><b class="${s.bank.insured ? 'c-jade' : 'c-dim'}">${s.bank.insured ? '가입' : '미가입'}</b></div>
    <div class="meta">자본이 마이너스가 되는 시점에 1회에 한해 부채 40%를 탕감하고 최소 운영 자금을 지급합니다.</div>
    <div class="btn-row"><button class="btn ${s.bank.insured ? 'blood' : 'jade'}" id="ins">${s.bank.insured ? '해지' : '가입'}</button></div>
  </div>`;

  $('right-body').innerHTML = h;
  const R = $('right-body');
  R.querySelectorAll('[data-loan]').forEach(b => b.onclick = () => { takeLoan(s, 'op', +b.dataset.loan); renderAll(); });
  R.querySelectorAll('[data-repay]').forEach(b => b.onclick = () => { repayLoan(s, s.bank.loans[+b.dataset.repay]); renderAll(); });
  $('ins').onclick = () => { s.bank.insured = !s.bank.insured; renderRight(); };
  $('donate').onclick = () => {
    const c = donateCost(s); if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
    s.co.cash -= c; s.co.donate = Math.min(18, s.co.donate + 4);
    news(`${s.co.name}, ${won(c)} 사회공헌 기부`); toast('신용 평가에 반영됩니다', 'good'); renderAll();
  };
}

const donateCost = s => Math.round(Math.max(2e6, s.co.cap * 0.012));

function openAcqLoan(tgt, price) {
  const s = S, limit = Math.min(loanLimit(s, 'acq', price), price);
  const need = Math.max(0, price - s.co.cash);
  const rate = loanRate(s, 'acq');
  openModal({
    title: '인수금융 신청',
    body: `<div class="kv"><span>인수가</span><b>${won(price)}</b></div>
      <div class="kv"><span>보유 자금</span><b>${won(s.co.cash)}</b></div>
      <div class="kv"><span>부족액</span><b class="c-blood">${won(need)}</b></div>
      <div class="kv"><span>대출 한도</span><b class="c-gold">${won(limit)}</b></div>
      <div class="kv"><span>금리 / 기간</span><b>${rate.toFixed(2)}% / ${BAL.loanTermMonths}개월</b></div>
      <p style="margin-top:10px;font-size:11px" class="c-dim">인수 기업이 담보로 설정됩니다. 상환에 실패하면 해당 계열사가 압류됩니다.</p>`,
    choices: [
      { label: `${won(need)} 대출받고 인수 완료`, dis: need > limit,
        sub: need > limit ? `한도 ${won(limit)} 초과 — 인수 불가` : `월 상환액 약 ${won(monthlyDue(need, rate))}`,
        run: () => { takeLoan(s, 'acq', need, tgt.name); s.co.cash -= price; completeAcq(s, tgt, price); renderAll(); } },
      { label: '인수 포기', sub: '협상 결과를 파기합니다', run: () => { news(`${tgt.name} 인수 무산 — 자금 조달 실패`); renderAll(); } },
    ],
  });
}

function monthlyDue(amt, rate) { const i = rate / 1200; return Math.round(amt * i / (1 - Math.pow(1 + i, -BAL.loanTermMonths))); }

export { donateCost, monthlyDue, openAcqLoan, tabBank };
