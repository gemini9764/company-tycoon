import { sfx } from '../core/audio.js';
import { BAL } from '../core/balance.js';
import { S } from '../core/state.js';
import { clamp, won } from '../core/util.js';
import { retailPotential } from '../systems/economy.js';
import { renderHud } from './hud.js';
import { openModal } from './modal.js';
import { news, toast } from './toast.js';

/* ══════════════════════════════════════════════════════════════
   사장실 결재 — 하루 1회

   사옥 캔버스에서 사장 책상을 누르면 열린다. 리스크 수치를 **내리는** 유일한
   수단이라, 무속·로비 루트가 한 방향으로만 쌓여 반드시 스캔들로 끝나던 문제
   (HANDOFF 남은 과제)를 여기서 푼다.

   하루 1회 제한을 두는 이유는 돈으로 리스크를 무제한 세탁하지 못하게 하려는 것.
   비용은 회사 규모를 따라가므로 후반에도 공짜가 되지 않는다.
   ══════════════════════════════════════════════════════════════ */
const deskCost = (s, mul) => Math.round(Math.max(2e6, retailPotential(s) * 2.2) * mul);

/** 오늘 결재를 이미 했는지 */
function deskUsed(s) { return (s.co.deskDay || 0) === s.day; }

const ITEMS = [
  {
    id: 'donate', n: '사회 공헌 기부', mul: 1.6,
    sub: () => `신용 가산 +0.4 · 미신지수 -${DONATE_MISTRUST}`,
    run: s => {
      s.co.donate = (s.co.donate || 0) + 0.4;
      s.co.mistrust = Math.max(0, s.co.mistrust - DONATE_MISTRUST);
      news(`${s.co.name}, 사회 공헌 기부`);
      toast('신용이 오르고 미신지수가 내렸습니다', 'good');
    },
  },
  {
    id: 'press', n: '언론 대응', mul: 1.9,
    sub: () => `수사 압박 -${PRESS_PROBE}`,
    run: s => {
      s.co.probe = Math.max(0, s.co.probe - PRESS_PROBE);
      toast(`수사 압박 -${PRESS_PROBE}`, 'good');
    },
  },
  {
    id: 'care', n: '사내 복지', mul: 1.2,
    sub: () => '전 직원 경험치 +12 · 인지도 +0.08',
    run: s => {
      s.staff.forEach(e => { e.exp = (e.exp || 0) + 12; });
      s.co.marketing = clamp(s.co.marketing + 0.08, 0, BAL.marketingCap);
      toast('직원 사기가 올랐습니다', 'good');
    },
  },
];

const DONATE_MISTRUST = 6;
const PRESS_PROBE = 9;

function openDesk() {
  const s = S;
  if (deskUsed(s)) return toast('오늘은 이미 결재를 마쳤습니다');
  openModal({
    title: '사장실 — 오늘의 결재',
    body: `<p>하루에 한 건만 처리할 수 있습니다.</p>
      <div class="kv" style="margin-top:8px"><span>미신지수</span><b class="${s.co.mistrust >= BAL.mistrustPenaltyAt ? 'c-mauve' : ''}">${Math.round(s.co.mistrust)} / 100</b></div>
      <div class="kv"><span>수사 압박</span><b class="${s.co.probe >= 50 ? 'c-blood' : ''}">${Math.round(s.co.probe)} / 100</b></div>`,
    choices: [
      ...ITEMS.map(it => {
        const c = deskCost(s, it.mul);
        return {
          label: `${it.n} — ${won(c)}`, sub: it.sub(),
          disabled: s.co.cash < c,
          run: () => {
            if (s.co.cash < c) return toast('자금이 부족합니다', 'bad');
            s.co.cash -= c;
            s.co.deskDay = s.day;
            it.run(s);
            sfx('coin');
            renderHud();
          },
        };
      }),
      { label: '오늘은 넘어간다', run: () => {} },
    ],
  });
}

export { DONATE_MISTRUST, ITEMS, PRESS_PROBE, deskCost, deskUsed, openDesk };
