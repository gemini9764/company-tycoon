import { BAL } from '../core/balance.js';
import { DIFFS } from '../core/data.js';
import { $, chance, clamp } from '../core/util.js';
import { checkEnding } from './ending.js';
import { negoFor, negosOf } from './mna.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ── 무당 ────────────────────────────────────────────────── */
function shamanFee(s, sh) { return Math.round(Math.max(2e6, s.co.cap * sh.feeMul)); }

function doGut(s, kind, targetId) {
  const sh = s.shaman.hired; if (!sh) return;
  const fee = shamanFee(s, sh);
  if (s.co.cash < fee) return toast('굿 비용이 부족합니다', 'bad');
  s.co.cash -= fee;
  s.co.mistrust = clamp(s.co.mistrust + BAL.gutMistrust, 0, 100);

  let rate = sh.rate;
  if (s.co.mistrust > BAL.mistrustPenaltyAt) rate -= 0.10;
  const ok = chance(rate);
  const tgt = s.market.find(c => c.id === targetId);

  if (kind === 'sal') {
    if (ok) {
      tgt.curse = 3;
      if (tgt.diff > 0) tgt.diff--;
      if (tgt.listed) tgt.price = Math.round(tgt.price * 0.80);
      { const n = negoFor(s, tgt.id); if (n) { n.diff = tgt.diff; n.prem = Math.max(0.02, n.prem - 0.12); } }
      pushInbox(s, '살굿 적중', `${tgt.name}에 악재가 발생했습니다. 인수 난이도가 <b>${DIFFS[tgt.diff].name}</b>(으)로 내려가고 주가가 급락했습니다.`, 'good');
    } else {
      // 신벌 — 역풍 살
      negosOf(s).forEach(n => { n.success = clamp(n.success - 15, 0, 100); });
      if (chance(0.5)) s.co.cash -= fee * 2;
      pushInbox(s, '신벌 — 역풍 살', `굿이 실패해 살이 자사로 돌아왔습니다. 협상 성공도가 크게 하락했습니다.`, 'bad');
    }
  } else {
    if (ok) {
      negosOf(s).forEach(n => { n.success = clamp(n.success + 14 * sh.power, 0, 100); n.blessed++; });
      s.co.marketing = Math.min(BAL.marketingCap, s.co.marketing + 0.15);
      pushInbox(s, '축원굿 성공', '자사에 축복이 내렸습니다. 협상 성공도와 회사 이미지가 올랐습니다.', 'good');
    } else {
      negosOf(s).forEach(n => { n.success = clamp(n.success - 5, 0, 100); });
      if (chance(0.35)) s.co.cash -= fee;
      pushInbox(s, '축원굿 실패', '굿 효과가 나타나지 않았습니다.', 'bad');
    }
  }

  if (chance(sh.expose)) {
    s.co.mistrust = clamp(s.co.mistrust + 15, 0, 100);
    s.co.probe += 8;
    news(`${s.co.name} '미신 경영' 논란… 굿판 정황 포착`);
    pushInbox(s, '미신 경영 스캔들', '무속 공작이 언론에 포착됐습니다. 신용 등급이 하락하고 수사 압박이 커집니다.', 'bad');
  }
  checkEnding(s);
}

export { doGut, shamanFee };
