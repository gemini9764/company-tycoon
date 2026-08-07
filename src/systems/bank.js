import { BAL } from '../core/balance.js';
import { debtTotal, grossAssets } from '../core/derive.js';
import { $, won } from '../core/util.js';
import { creditIdx, loanRate, recalcCap } from './company.js';
import { endGame } from './ending.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ── 은행 ────────────────────────────────────────────────── */
function loanLimit(s, kind, price) {
  const coef = 0.5 + creditIdx(s) * 0.09;
  if (kind === 'acq') return Math.round(price * BAL.acqLoanRatio * coef * 1.35);
  return Math.max(0, Math.round(grossAssets(s) * BAL.opLoanRatio * coef) - debtTotal(s));
}

/** 원리금 균등 월 상환액. UI(bankPanel)도 이걸 쓴다 — 예전엔 같은 식이
    두 파일에 각각 있었고, 번들러가 이름 충돌로 잡아내면서 드러났다. */
function monthlyDue(amount, rate, m = BAL.loanTermMonths) {
  const i = rate / 1200;
  return Math.round(amount * i / (1 - Math.pow(1 + i, -m)));
}

function takeLoan(s, kind, amount, collateral) {
  const rate = loanRate(s, kind);
  const m = BAL.loanTermMonths;
  const due = monthlyDue(amount, rate, m);
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
  /* **압류로 빚이 사라지지는 않는다.** 예전에는 담보를 넘기면서 대출을 통째로
     지웠는데, 그러면 '빌려서 쓰고 회사만 반납하면 채무 소멸' 이라 무한 디폴트가
     정답이 됐다 (계측: 압류를 파산 카운트에서 빼자 reckless 가 0/6 파산에
     완주 535일 — 무차입보다 200일 빨랐다).
     담보 처분가(subSellRate)로 회수하고 **모자란 만큼만 무담보 채무로 남긴다.**
     이 잔여 채무가 갚지 못하면 연체로 쌓여 파산으로 간다 — 대가가 압류 한 번에
     끝나지 않고 현금흐름으로 이어진다. */
  /* 압류도 연체로 센다 — 다만 카운트는 **연속** 기준이라(economy.js:tickMonth)
     한 달만 정상 상환하면 초기화된다. 압류를 카운트에서 아예 빼 봤더니
     reckless 가 0/6 파산에 완주 584일로 무차입(726)보다 20% 빨라졌다.
     빌린 돈으로 산 회사를 반납하는 것이 무료 탈출구가 되면 안 된다. */
  s.bank.overdue++;
  const recover = sub.cap * BAL.subSellRate;
  const short = Math.max(0, Math.round(l.left - recover));
  if (short > 0) {
    const rate = loanRate(s, 'op');
    s.bank.loans.push({ kind: 'op', principal: short, left: short, rate,
                        months: BAL.loanTermMonths, due: monthlyDue(short, rate, BAL.loanTermMonths), collateral: null });
  }
  news(`${s.co.name}, ${sub.name} 채권단에 압류`);
  pushInbox(s, '계열사 압류',
    `인수 대출 상환에 실패해 <b>${sub.name}</b>이(가) 채권단에 넘어갔습니다. 해당 매출이 그룹에서 빠지고 재인수 난이도가 올라갑니다.`
    + (short > 0 ? `<br>처분가로 다 갚지 못한 <b class="c-blood">${won(short)}</b>은 무담보 채무로 남습니다.` : ''), 'bad');
  recalcCap(s);
}

function checkBankrupt(s) {
  /* 연체 **연속** 3회는 현금이 양수여도 파산이다. 예전에는 아래 early return
     때문에 현금이 마이너스일 때만 판정돼, 연체 4회를 쌓고도 멀쩡히 완주하는
     판이 나왔다 — 알림은 "3회면 파산"이라고 약속하고 있었다.
     카운트 초기화는 economy.js:tickMonth 가 한다. */
  if (s.bank.overdue >= 3) return endGame(s, 'bankrupt');
  if (s.co.cash >= 0) { s.co.negMonths = 0; return; }
  s.co.negMonths++;
  if (s.bank.insured) {
    s.bank.insured = false;
    const cut = debtTotal(s) * 0.4;
    s.bank.loans.forEach(l => l.left *= 0.6);
    s.co.cash = grossAssets(s) * 0.02;
    pushInbox(s, '파산 보험 발동', `부채 ${won(cut)}이 탕감되고 최소 운영 자금이 지급됐습니다. 보험은 소멸합니다.`, 'good');
    return;
  }
  if (s.co.negMonths >= BAL.negMonthsToBust) endGame(s, 'bankrupt');
}

export { checkBankrupt, loanLimit, monthlyDue, repayLoan, seizeSub, takeLoan };
