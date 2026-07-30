import { S } from './state.js';
import { toast } from '../ui/toast.js';

/* ── 저장 (서버 없음) ─────────────────────────────────────── */
const SAVE_KEY = 'company-tycoon-save';

const Store = {
  mode: 'memory', mem: {},
  async init() {
    if (typeof window !== 'undefined' && window.storage?.get) { this.mode = 'artifact'; return; }
    try {
      localStorage.setItem('__t', '1'); localStorage.removeItem('__t');
      this.mode = 'local';
    } catch { this.mode = 'memory'; }
  },
  async get(k) {
    try {
      if (this.mode === 'artifact') { const r = await window.storage.get(k); return r ? r.value : null; }
      if (this.mode === 'local') return localStorage.getItem(k);
      return this.mem[k] ?? null;
    } catch { return null; }
  },
  async set(k, v) {
    try {
      if (this.mode === 'artifact') return void await window.storage.set(k, v);
      if (this.mode === 'local') return void localStorage.setItem(k, v);
      this.mem[k] = v;
    } catch { /* 저장 실패는 게임 진행을 막지 않음 */ }
  },
  async del(k) {
    try {
      if (this.mode === 'artifact') return void await window.storage.delete(k);
      if (this.mode === 'local') return void localStorage.removeItem(k);
      delete this.mem[k];
    } catch {}
  },
};

async function saveGame(silent) {
  await Store.set(SAVE_KEY, JSON.stringify(S));
  if (!silent) toast('저장했습니다 (' + { artifact:'브라우저 저장소', local:'localStorage', memory:'메모리(새로고침 시 소실)' }[Store.mode] + ')', 'good');
}

async function loadGame() {
  const raw = await Store.get(SAVE_KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && d.v === 3 ? d : null;   // 구버전 세이브는 폐기
  } catch { return null; }
}

export { SAVE_KEY, Store, loadGame, saveGame };
