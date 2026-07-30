/**
 * 개발용 정적 서버. ES 모듈은 file:// 에서 CORS로 막히므로 http 로 띄운다.
 * 외부 의존 없이 node 만으로 돈다.
 *
 *   node tools/serve.mjs [--port=5173]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? Number(portArg.split('=')[1]) : 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, rel);
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const buf = await readFile(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
  }
}).listen(PORT, () => console.log(`개발 서버 → http://localhost:${PORT}`));
