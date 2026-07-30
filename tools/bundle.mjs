/**
 * 의존성 없는 ES 모듈 번들러.
 *
 * 외부 패키지를 쓰지 않는 이유는 하나다. 소스를 받은 사람이 `npm install` 없이
 * 바로 빌드할 수 있어야 하기 때문. 범용 번들러가 아니라 이 프로젝트의 모듈 형태
 * (상단 import 들 → 본문 → 하단 export 하나)만 처리한다.
 *
 * 동작:
 *   1. 엔트리에서 시작해 import 를 따라가며 모듈 그래프를 만든다
 *   2. 후위 순회로 정렬한다. 순환은 역방향 간선을 끊어 처리한다
 *      (선언된 함수는 호이스팅되므로 순환이 있어도 런타임에는 문제없다)
 *   3. import/export 구문을 걷어내고 한 스코프로 이어 붙인다
 *
 * 원본이 단일 파일이었던 덕에 최상위 이름이 전부 고유하다. 그래서 이름 충돌
 * 걱정 없이 그냥 이어 붙일 수 있다. 새 파일을 추가할 때 이 전제가 깨지면
 * checkNames() 가 빌드를 멈춘다.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const RE_IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const RE_IMPORT_NS    = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const RE_IMPORT_BARE  = /^import\s*['"]([^'"]+)['"]\s*;?\s*$/;
const RE_EXPORT_LIST  = /^export\s*\{([^}]*)\}\s*;?\s*$/;

/** 한 파일을 읽어 import 목록 / 본문 / export 목록으로 가른다. */
async function parseModule(file) {
  const raw = await readFile(file, 'utf8');
  const deps = [];          // { spec, kind: 'named'|'ns'|'bare', ns? }
  const exports = [];
  const body = [];

  for (const line of raw.split('\n')) {
    // import/export 줄에 후행 주석이 붙어 있어도 인식되게 걷어낸다
    let t = line.trim();
    if (/^(import|export)\b/.test(t)) t = t.replace(/\s*\/\/.*$/, '');
    let m;
    if ((m = t.match(RE_IMPORT_NAMED))) { deps.push({ spec: m[2], kind: 'named' }); continue; }
    if ((m = t.match(RE_IMPORT_NS)))    { deps.push({ spec: m[2], kind: 'ns', ns: m[1] }); continue; }
    if ((m = t.match(RE_IMPORT_BARE)))  { deps.push({ spec: m[1], kind: 'bare' }); continue; }
    if ((m = t.match(RE_EXPORT_LIST)))  {
      exports.push(...m[1].split(',').map(s => s.trim()).filter(Boolean));
      continue;
    }
    if (/^export\s+(function|const|let|var|class)\s/.test(t)) {
      body.push(line.replace(/^(\s*)export\s+/, '$1'));   // `export function x` 형태도 허용
      continue;
    }
    body.push(line);
  }
  return { file, deps, exports, body: body.join('\n').trim() };
}

/** 엔트리에서 도달 가능한 모듈을 모두 읽는다. */
async function collect(entry) {
  const mods = new Map();
  const queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.shift();
    if (mods.has(file)) continue;
    const mod = await parseModule(file);
    mods.set(file, mod);
    for (const d of mod.deps) {
      d.file = resolve(dirname(file), d.spec);
      queue.push(d.file);
    }
  }
  return mods;
}

/** 후위 순회 정렬. 방문 중인 모듈을 다시 만나면(순환) 그 간선은 건너뛴다. */
function order(mods, entry) {
  const out = [], done = new Set(), visiting = new Set();
  (function walk(file) {
    if (done.has(file) || visiting.has(file)) return;
    visiting.add(file);
    for (const d of mods.get(file).deps) walk(d.file);
    visiting.delete(file);
    done.add(file);
    out.push(file);
  })(resolve(entry));
  return out;
}

/** 최상위 이름이 전부 고유한지 확인한다. 겹치면 이어 붙일 수 없다. */
function checkNames(mods, root) {
  // 반환값 없이 예외로만 알린다 — 겹치면 빌드를 세운다.
  const seen = new Map(), dup = [];
  const DECL = /^(?:\s*)(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
  for (const [file, mod] of mods) {
    let depth = 0;
    for (const line of mod.body.split('\n')) {
      if (depth === 0) {
        const m = line.match(DECL);
        if (m) {
          const name = m[2];
          if (seen.has(name)) dup.push(`${name}  (${seen.get(name)} ↔ ${relative(root, file)})`);
          else seen.set(name, relative(root, file));
        }
      }
      depth += (line.match(/[{([]/g) || []).length - (line.match(/[})\]]/g) || []).length;
      depth = Math.max(0, depth);
    }
  }
  for (const mod of mods.values())
    for (const d of mod.deps)
      if (d.kind === 'ns' && seen.has(d.ns))
        dup.push(`${d.ns}  (네임스페이스 ↔ ${seen.get(d.ns)})`);
  if (dup.length) {
    throw new Error(
      '최상위 이름이 겹칩니다. 번들러가 모듈을 한 스코프로 합치므로 고유해야 합니다:\n  ' +
      dup.join('\n  '));
  }
}

/**
 * 엔트리를 IIFE 한 덩어리로 번들한다.
 * @returns {Promise<string>}
 */
export async function bundle(entry, { root = process.cwd() } = {}) {
  const mods = await collect(entry);
  checkNames(mods, root);
  const files = order(mods, entry);

  const chunks = [];
  for (const file of files) {
    const mod = mods.get(file);
    chunks.push(`// ── ${relative(root, file)} ${'─'.repeat(Math.max(0, 58 - relative(root, file).length))}`);
    chunks.push(mod.body);

    // `import * as ns` 로 참조되는 모듈은 네임스페이스 객체를 만들어 준다.
    // getter 로 감싸야 재할당되는 바인딩(S 등)이 최신값으로 보인다.
    const nsNames = new Set(
      [...mods.values()].flatMap(m => m.deps.filter(d => d.file === file && d.kind === 'ns').map(d => d.ns)));
    for (const ns of nsNames) {
      const props = mod.exports.map(n => `  get ${n}() { return ${n}; },`).join('\n');
      chunks.push(`const ${ns} = {\n${props}\n};`);
    }
    chunks.push('');
  }

  return `(function () {\n'use strict';\n\n${chunks.join('\n')}\n})();\n`;
}
