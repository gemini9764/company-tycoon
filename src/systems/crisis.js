import { BAL } from '../core/balance.js';
import { pause, resume } from '../core/clock.js';
import { SECTORS, SECTOR_KEYS } from '../core/data.js';
import { netWorth } from '../core/derive.js';
import { chance, pick, won } from '../core/util.js';
import { sectorCount } from '../core/tags.js';
import { openModal } from '../ui/modal.js';
import { news, pushInbox, toast } from '../ui/toast.js';

/* ══════════════════════════════════════════════════════════════
   경제 위기 — 후반 유일한 긴장

   자본이 쌓이고 나면 일반적인 자금 소모로는 절대 망하지 않는다. 그 지점부터
   게임에 아무 일도 일어나지 않는 것이 지금까지의 문제였다.

   **규칙 세 가지를 지킨다.**

   1. 반드시 예고한다. 캐주얼에서 최악은 "아무것도 잘못 안 했는데 망했다"이다.
      D-30 뉴스 → D-15 인박스(대비 안내) → D-0 발동. 조작은 0개 늘어난다.
   2. 대비 수단은 전부 이미 손에 있다 — 현금 비중 · 부채 · 파산 보험 ·
      **업종 분산**. 특히 마지막이 중요하다. 지금까지 업종 집중은 순이득뿐이라
      고민이 없었는데, 위기 때 집중 업종이 더 크게 맞으면 사업부 시스템에
      처음으로 트레이드오프가 생긴다.
   3. 위험이자 기회다. 위기 중에는 매물이 싸진다. 현금을 쥐고 있던 플레이어는
      여기서 판을 뒤집는다 — 손실만 있으면 그냥 벌칙이지 이벤트가 아니다.
   ══════════════════════════════════════════════════════════════ */

const CRISES = [
  { n: '외환 위기',   d: '환율이 폭등하고 단기 자금 시장이 얼어붙었습니다.' },
  { n: '금융 위기',   d: '해외 투자은행이 연쇄 도산하며 신용이 말랐습니다.' },
  { n: '원자재 파동', d: '원자재 값이 폭등해 제조 원가가 감당이 안 됩니다.' },
];

const crisisOf = s => (s.crisis ||= { due: 0, until: 0, warned: 0, hard: null, name: '' });

/** 위기가 진행 중인가 */
const inCrisis = s => crisisOf(s).until > s.day;

/** 위기 중 계열사 수익 배수. 긴축을 골랐으면 손실이 이만큼 줄어든다 */
const easedMul = (c, base) => Math.min(1, base + (c.eased ? BAL.crisisEaseUp : 0));

/** 계열사 수익에 곱해지는 배수. 집중한 업종이 더 크게 맞는다 */
function crisisMul(s, sector) {
  const c = crisisOf(s);
  if (c.until <= s.day) return 1;
  return easedMul(c, sector === c.hard ? BAL.crisisHardMul : BAL.crisisMul);
}

/** 위기 중에는 매물이 싸다 — 현금을 쥔 쪽에게 기회다 */
const crisisPriceMul = s => (inCrisis(s) ? BAL.crisisPriceMul : 1);

function tickCrisis(s) {
  const c = crisisOf(s);

  // 끝났다
  if (c.until && s.day === c.until) {
    news('경제 위기 종료 — 시장이 회복세로 돌아섰습니다');
    pushInbox(s, '위기 종료', '시장이 회복됐습니다. 계열사 수익이 정상으로 돌아오고 매물 값도 제자리를 찾습니다.', 'good');
    c.hard = null; c.eased = false;   // 다음 위기로 새지 않게 같이 지운다
    return;
  }
  if (c.until > s.day) return;                       // 진행 중이면 아무것도 안 한다

  /* 예약. 자본이 충분히 쌓여 일반 소모로는 안 망하는 시점부터만 걸린다.
     쿨다운을 둬 한 판에 두 번까지만 온다. */
  if (!c.due) {
    if (netWorth(s) < BAL.crisisFrom) return;
    if (s.day - (c.last || 0) < BAL.crisisCooldown) return;
    if (!chance(BAL.crisisChancePerDay)) return;
    const k = pick(CRISES);
    c.due = s.day + BAL.crisisWarnDays;
    c.name = k.n; c.desc = k.d; c.warned = 0;
    news(`해외 금융시장 불안 — ${k.n} 우려`);
    return;
  }

  // D-15 — 대비 안내. 여기가 "무엇을 할 수 있는지" 알려 주는 유일한 지점이다
  const left = c.due - s.day;
  if (!c.warned && left <= BAL.crisisWarnDays / 2) {
    c.warned = 1;
    const by = sectorCount(s);
    const top = SECTOR_KEYS.filter(k => by[k]).sort((a, b) => by[b] - by[a])[0];
    pushInbox(s, `${c.name} 경보 — ${left}일 뒤`,
      `<b>${c.name}</b>가 임박했습니다.<br><br>` +
      `· 계열사 수익이 크게 떨어집니다. <b>가장 많이 가진 업종</b>이 특히 크게 맞습니다` +
      (top ? ` (지금은 <b>${SECTORS[top].name}</b> ${by[top]}개)` : '') + '<br>' +
      '· 대출이 있으면 상환 부담이 그대로 남습니다<br>' +
      '· <b>현금을 쥐고 있으면 매물을 싸게 살 기회</b>이기도 합니다<br><br>' +
      '지금 할 수 있는 것 — 파산 보험 가입 · 대출 상환 · 업종 분산 · 인수 속도 조절.', 'bad');
    toast(`${c.name} ${left}일 전 — 인박스를 확인하세요`, 'bad');
    return;
  }

  if (s.day < c.due) return;
  fire(s, c);
}

/** 발동. 선택은 한 번뿐이다 — 위기마다 모달이 연쇄되면 그게 피로다 */
function fire(s, c) {
  const by = sectorCount(s);
  const top = SECTOR_KEYS.filter(k => by[k]).sort((a, b) => by[b] - by[a])[0];
  c.hard = top || null;
  c.until = s.day + BAL.crisisDays;
  c.due = 0; c.last = s.day;

  const hit = Math.round((1 - BAL.crisisMul) * 100);
  const hardHit = Math.round((1 - BAL.crisisHardMul) * 100);
  const insured = s.bank.insured;

  pause();
  news(`${c.name} 발생 — 시장 급락`);
  openModal({
    title: `${c.name}`,
    body: `<p>${c.desc}</p>
      <div class="kv" style="margin-top:10px"><span>계열사 수익</span><b class="c-blood">-${hit}%</b></div>
      ${c.hard ? `<div class="kv"><span>${SECTORS[c.hard].name} 계열사</span><b class="c-blood">-${hardHit}%</b></div>` : ''}
      <div class="kv"><span>매물 값</span><b class="c-jade">-${Math.round((1 - BAL.crisisPriceMul) * 100)}%</b></div>
      <div class="kv"><span>기간</span><b>${BAL.crisisDays}일</b></div>
      <div class="kv" style="border-top:2px solid var(--paper-3);margin-top:6px;padding-top:6px">
        <span>보유 자금</span><b class="${s.co.cash > 0 ? 'c-gold' : 'c-blood'}">${won(s.co.cash)}</b></div>
      <div class="kv"><span>파산 보험</span><b class="${insured ? 'c-jade' : 'c-dim'}">${insured ? '가입' : '없음'}</b></div>
      <p style="margin-top:8px;font-size:12px" class="c-dim">싸진 매물을 노릴지, 몸을 웅크릴지 고르세요.</p>`,
    choices: [
      { label: '버틴다 — 아무것도 팔지 않는다',
        sub: '손실을 전부 떠안습니다. 위기가 끝나면 그대로 회복합니다',
        run: () => { toast(`${c.name} — 버티기로 했습니다`, 'bad'); resume(); } },
      { label: '허리띠를 조인다 — 인지도 예산을 끊는다',
        sub: `인지도 -0.3 · 계열사 수익 손실 ${hit}% → ${Math.round((1 - BAL.crisisMul - BAL.crisisEaseUp) * 100)}% 로 완화`,
        run: () => {
          s.co.marketing = Math.max(0.5, s.co.marketing - 0.3);
          c.eased = true;
          toast('긴축 — 손실을 조금 줄였습니다');
          resume();
        } },
    ],
  });
}

export { CRISES, crisisMul, crisisOf, crisisPriceMul, inCrisis, tickCrisis };
