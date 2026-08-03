/**
 * 검증용 공통 하네스.
 *
 * 빌드된 단일 HTML을 jsdom에 띄운다. 실제 배포물을 그대로 검사하므로
 * 번들 과정에서 생기는 문제까지 같이 잡힌다.
 */
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function boot({ silent = true } = {}) {
  const html = await readFile(join(ROOT, 'dist/company-tycoon.html'), 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://localhost/',
    beforeParse(w) {
      // jsdom에는 캔버스 2D 컨텍스트가 없다. 호출만 삼키는 스텁을 끼운다.
      const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 20 }) : () => {}),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      w.requestAnimationFrame = () => 0;         // 렌더 루프는 수동으로 돌린다
      w.addEventListener('error', e => errors.push(e.message));
      w.console.error = (...a) => errors.push(a.join(' '));
      if (silent) w.console.log = () => {};
    },
  });

  await new Promise(r => setTimeout(r, 300));    // 스크립트 평가 대기

  const win = dom.window;
  if (!win.game) throw new Error('window.game 이 없습니다 — src/debug.js 로드를 확인하세요');
  return { dom, win, doc: win.document, game: win.game, errors };
}

/** 타이틀 → 새로 시작 → 인트로 모달을 넘기고 게임을 시작한다. */
export function startGame(doc, name = '테스트상사') {
  const title = doc.getElementById('title-new');
  if (title) title.click();
  const input = doc.getElementById('co-name');
  if (!input) throw new Error('인트로 모달이 뜨지 않았습니다');
  input.value = name;
  doc.querySelector('#modal [data-a="0"]').click();
}

/** 열려 있는 모달을 첫 번째 선택지로 계속 닫는다. */
export function resolveModals(doc, pickLabel) {
  let guard = 0;
  while (doc.getElementById('modal-layer').classList.contains('on') && guard++ < 8) {
    const choices = [...doc.querySelectorAll('#modal .choice:not([disabled])')];
    const btn = (pickLabel && choices.find(c => pickLabel.test(c.textContent)))
              || choices[0] || doc.querySelector('#modal [data-a]');
    if (!btn) break;
    btn.click();
  }
}
