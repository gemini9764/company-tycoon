
import { S } from './state.js';
import { renderHud } from '../ui/hud.js';

/** 이벤트 모달이 뜬 동안 진행을 멈춘다. 재개 시 이전 배속을 복원한다. */
let pausedSpeed = null;

function pause()  { if (pausedSpeed === null) { pausedSpeed = S.speed; S.speed = 0; renderHud(); } }

function resume() { if (pausedSpeed !== null) { S.speed = pausedSpeed; pausedSpeed = null; renderHud(); } }

function clearPause() { pausedSpeed = null; }

export { pause, resume, clearPause };
