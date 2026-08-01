/**
 * QA 디버그 핸들.
 *
 * 네임스페이스 이름에 Mod 접미사를 붙인 이유: 번들러가 모든 모듈을 한 스코프로
 * 합치기 때문에 `toast` 같은 함수명과 겹치면 안 된다.
 *
 * 번들이 IIFE라 내부 심볼이 전역에 노출되지 않는다. 자동화 테스트와 브라우저
 * 콘솔에서 내부 상태를 들여다볼 창구가 필요해 한곳에 모아 window.game 으로 내보낸다.
 * 게임 로직은 이 파일에 의존하지 않는다 — 지우면 창구만 사라진다.
 */
import * as balanceMod from './core/balance.js';
import * as clockMod from './core/clock.js';
import * as dataMod from './core/data.js';
import * as deriveMod from './core/derive.js';
import * as loopMod from './core/loop.js';
import * as stateMod from './core/state.js';
import * as storageMod from './core/storage.js';
import * as utilMod from './core/util.js';
import * as canvasMod from './render/canvas.js';
import * as bankMod from './systems/bank.js';
import * as companyMod from './systems/company.js';
import * as economyMod from './systems/economy.js';
import * as endingMod from './systems/ending.js';
import * as eventsMod from './systems/events.js';
import * as mnaMod from './systems/mna.js';
import * as rumorMod from './systems/rumor.js';
import * as shamanMod from './systems/shaman.js';
import * as stockMod from './systems/stock.js';
import * as bankPanelMod from './ui/bankPanel.js';
import * as companyPopupMod from './ui/companyPopup.js';
import * as dockMod from './ui/dock.js';
import * as iconsMod from './ui/icons.js';
import * as hudMod from './ui/hud.js';
import * as panelLeftMod from './ui/panelLeft.js';
import * as toastMod from './ui/toast.js';
import * as uiMod from './ui/index.js';
import * as modalMod from './ui/modal.js';
import * as tabsMod from './ui/tabs.js';

const api = {
  ...balanceMod, ...clockMod, ...dataMod, ...deriveMod, ...loopMod, ...stateMod, ...storageMod, ...utilMod,
  ...canvasMod, ...bankMod, ...companyMod, ...economyMod, ...endingMod, ...eventsMod, ...mnaMod,
  ...rumorMod, ...shamanMod, ...stockMod,
  ...bankPanelMod, ...companyPopupMod, ...dockMod, ...iconsMod, ...hudMod, ...panelLeftMod, ...toastMod, ...uiMod, ...modalMod, ...tabsMod,
};

// S 는 교체되는 라이브 바인딩이라 스프레드로는 최신값이 안 잡힌다. getter로 노출한다.
Object.defineProperty(api, 'S', { get: () => stateMod.S });

if (typeof window !== 'undefined') window.game = api;

export { api };
