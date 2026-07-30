/**
 * 배포용 단일 HTML 빌드.
 *
 * 개발은 ES 모듈로 하되 배포물은 파일 하나로 만든다. 받는 사람이 서버 없이
 * 더블클릭으로 열 수 있어야 해서 CSS·JS를 전부 인라인한다.
 * 외부 의존이 없어 `npm install` 없이 바로 돈다.
 *
 *   node tools/build.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bundle } from './bundle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const js = await bundle(join(ROOT, 'src/main.js'), { root: ROOT });
const css = await readFile(join(ROOT, 'src/styles/main.css'), 'utf8');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');

const out = html
  .replace('<link rel="stylesheet" href="src/styles/main.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/main.js"></script>', `<script>\n${js}\n</script>`);

await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist/company-tycoon.html'), out, 'utf8');

console.log(`빌드 완료 → dist/company-tycoon.html  (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);
