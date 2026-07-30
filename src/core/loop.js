import { BAL } from './balance.js';
import { S } from './state.js';
import { saveGame } from './storage.js';
import { draw } from '../render/canvas.js';
import { checkTier, recalcCap } from '../systems/company.js';
import { tickEconomy, tickMonth } from '../systems/economy.js';
import { checkEnding } from '../systems/ending.js';
import { tickEvent } from '../systems/events.js';
import { tickNego } from '../systems/mna.js';
import { tickRumor } from '../systems/rumor.js';
import { tickStock } from '../systems/stock.js';
import { renderHud } from '../ui/hud.js';
import { renderLeft } from '../ui/panelLeft.js';
import { TAB, renderRight } from '../ui/tabs.js';

/* ══════════════════════════════════════════════════════════════
   LOOP — 하루 진행 타이머 + 렌더 프레임 분리
   ══════════════════════════════════════════════════════════════ */
let acc = 0, last = 0;

function tickDay() {
  const s = S;
  if (s.flags.ending) return;
  s.day++;
  tickEconomy(s);
  tickStock(s);
  tickNego(s);
  tickRumor(s);
  tickEvent(s);
  if (s.day % BAL.monthDays === 0) tickMonth(s);
  recalcCap(s);
  checkTier(s);
  checkEnding(s);
  if (s.day % 60 === 0) saveGame(true);
  renderHud(); renderLeft();
  if (['stock', 'bank', 'rumor'].includes(TAB)) renderRight();
}

function frameLoop(t) {
  const dt = last ? t - last : 16; last = t;
  if (S.speed > 0 && !S.flags.ending) {
    acc += dt * S.speed;
    while (acc >= BAL.dayMs) {
      acc -= BAL.dayMs; tickDay();
      if (S.speed === 0) { acc = 0; break; }   // 모달이 뜨면 즉시 멈춘다
    }
  }
  draw();
  requestAnimationFrame(frameLoop);
}

export { frameLoop, tickDay };
