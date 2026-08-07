/**
 * 상태 객체에 **없는 필드를 읽는 곳**을 찾는다.
 *
 * 왜 만들었나 — 협상단이 2팀이 되면서 s.nego(단일)가 s.negos(배열)로 바뀌었는데
 * UI 세 곳과 경험치 계산이 옛 필드를 계속 읽고 있었다. undefined 는 falsy 라
 * 예외 하나 없이 조용히 통과했고, 그 결과
 *
 *   · 협상단 전원이 expNego(4) 대신 expIdle(1) 을 받았다 (설계가 정반대로 뒤집힘)
 *   · 직원 카드가 협상 중에도 '협상 대기' 로 표시됐다
 *   · 협상 중인 직원을 아무 경고 없이 내보낼 수 있었다
 *
 * **스모크도 못 잡았다** — 그 케이스가 S.nego 를 손으로 세워 검사하고 있었다.
 * 이름을 바꾸는 리팩터링에서 반복될 사고라 기계로 막는다.
 *
 * 한계 — 정적 스캔이라 s 라는 이름의 변수만 본다. 오탐이 나오면 LATE 에 넣기
 * 전에 **정말 상태에 있어야 하는 값인지 먼저 의심할 것.**
 */
import { boot } from './harness.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const { win } = await boot();
const known = win.eval(`(() => {
  const g = window.game, S = g.setS(g.newState('필드', 1001));
  g.tickDay();
  return { s: Object.keys(S), co: Object.keys(S.co),
           bank: Object.keys(S.bank), stock: Object.keys(S.stock) };
})()`);

const ROOTS = [
  [/\b[sS]\.bank\.(\w+)/g, 'bank'],
  [/\b[sS]\.stock\.(\w+)/g, 'stock'],
  [/\b[sS]\.co\.(\w+)/g, 'co'],
  [/\b[sS]\.(\w+)/g, 's'],
];

/* 플레이 중에만 생기는 필드. newState 에는 없지만 정상이다. */
const LATE = new Set(['crisis', 'deficit', 'divKeys', 'eased', 'hard', 'priv']);

const files = [];
const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e =>
  e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') && files.push(join(d, e.name)));
walk('src');

const bad = [];
for (const f of files) {
  let inBlock = false;
  readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
    // 주석은 통째로 뺀다 — 이 도구를 만든 계기가 된 설명 주석들이 전부 오탐이었다
    if (inBlock) { if (raw.includes('*/')) inBlock = false; return; }
    if (/^\s*\/\*/.test(raw) && !raw.includes('*/')) { inBlock = true; return; }
    if (/^\s*(\/\/|\*)/.test(raw)) return;
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

    const seen = new Set();
    for (const [re, key] of ROOTS) {
      for (const m of line.matchAll(re)) {
        const field = m[1];
        if (seen.has(m.index)) continue;
        if (key === 's' && ['co', 'bank', 'stock'].includes(field)) continue;
        seen.add(m.index);
        if (known[key].includes(field) || LATE.has(field)) continue;
        bad.push(`${f.replace('src/', '')}:${i + 1}  ${key}.${field}`);
      }
    }
  });
}

if (!bad.length) {
  console.log('✓ 상태에 없는 필드를 읽는 곳 없음');
} else {
  console.error('✗ 상태에 없는 필드 — 이름이 바뀐 뒤 남은 참조일 수 있습니다');
  bad.forEach(b => console.error('  ' + b));
  process.exit(1);
}
