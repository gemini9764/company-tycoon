import { BAL } from '../core/balance.js';
import { debtTotal } from '../core/derive.js';
import { $, won } from '../core/util.js';
import { creditIdx, loanRate, recalcCap } from './company.js';
import { endGame } from './ending.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ── 은행 ────────────────────────────────────────────────── */
function loanLimit(s, kind, price) {
  const coef = 0.5 + creditIdx(s) * 0.09;
  if (kind === 'acq') return Math.round(price * BAL.acqLoanRatio * coef * 1.35);
  return Math.max(0, Math.round(s.co.cap * BAL.opLoanRatio * coef) - debtTotal(s));
}

function takeLoan(s, kind, amount, collateral) {
  const rate = loanRate(s, kind);
  const m = BAL.loanTermMonths;
  const i = rate / 1200;
  const due = Math.round(amount * i / (1 - Math.pow(1 + i, -m)));
  s.bank.loans.push({ kind, principal: amount, left: amount, rate, months: m, due, collateral: collateral || null });
  s.co.cash += amount;
  toast(`${won(amount)} 대출 실행 — 월 ${won(due)} × ${m}개월`, 'good');
}

function repayLoan(s, l) {
  if (s.co.cash < l.left) return toast('일시 상환할 자금이 부족합니다', 'bad');
  s.co.cash -= l.left;
  s.bank.loans.splice(s.bank.loans.indexOf(l), 1);
  toast('일시 상환 완료', 'good');
}

function seizeSub(s, l) {
  const i = s.co.subs.findIndex(c => c.name === l.collateral);
  if (i < 0) { s.bank.overdue++; return; }
  const sub = s.co.subs.splice(i, 1)[0];
  const m = s.market.find(c => c.id === sub.id);
  const origDiff = m?.diff0 ?? sub.diff;                    // 난이도를 올리기 전에 원래 값을 읽는다
  if (m) { m.owned = false; m.diff = Math.min(3, m.diff + 1); m.diff0 = Math.max(m.diff0, m.diff); }  // 되사기는 더 어려워진다
  if (origDiff >= 2) s.co.hardAcq = Math.max(0, s.co.hardAcq - 1);
  s.bank.overdue++;
  news(`${s.co.name}, ${sub.name} 채권단에 압류`);
  pushInbox(s, '계열사 압류', `인수금융 상환에 실패해 <b>${sub.name}</b>이(가) 채권단에 넘어갔습니다. 해당 매출이 그룹에서 빠지고 재인수 난이도가 올라갑니다.`, 'bad');
  recalcCap(s);
}

function checkBankrupt(s) {
  if (s.co.cash >= 0) { s.co.negMonths = 0; return; }
  s.co.negMonths++;
  if (s.bank.insured) {
    s.bank.insured = false;
    const cut = debtTotal(s) * 0.4;
    s.bank.loans.forEach(l => l.left *= 0.6);
    s.co.cash = s.co.cap * 0.02;
    pushInbox(s, '파산 보험 발동', `부채 ${won(cut)}이 탕감되고 최소 운영 자금이 지급됐습니다. 보험은 소멸합니다.`, 'good');
    return;
  }
  if (s.bank.overdue >= 3 || s.co.negMonths >= BAL.negMonthsToBust) endGame(s, 'bankrupt');
}

export { checkBankrupt, loanLimit, repayLoan, seizeSub, takeLoan };
