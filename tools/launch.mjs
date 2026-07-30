/**
 * 실행기 본체.
 *
 * 배치 파일(.bat)은 안에 한글이 있으면 cmd.exe 가 코드페이지 전환 지점에서
 * 파싱을 어긋내 버린다. 그래서 .bat/.command 는 ASCII 로만 두고 실제 일은
 * 여기서 한다. Node 는 stdout 에 UTF-8 을 쓰므로 콘솔이 65001 이면 한글이 제대로 나온다.
 *
 *   node tools/launch.mjs dev [--port=5173]
 *   node tools/launch.mjs build
 */
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const portArg = process.argv.find(a => a.startsWith('--port='));
const PORT = portArg ? Number(portArg.split('=')[1]) || 5173 : 5173;

/** OS 기본 앱으로 URL이나 폴더를 연다. */
function openExternal(target) {
  if (process.platform === 'win32') {
    // cmd 의 start 는 인자 인용 규칙이 까다로워 경로에 공백이 있으면 어긋난다.
    // explorer 는 URL 과 폴더를 모두 기본 앱으로 열어주고 인용도 단순하다.
    execFile('explorer', [target], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [target], () => {});
  } else {
    execFile('xdg-open', [target], () => {});
  }
}

/** 창이 바로 닫히지 않게 엔터를 기다린다. */
function waitEnter() {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) return resolve();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n엔터를 누르면 닫힙니다... ', () => { rl.close(); resolve(); });
  });
}

if (mode === 'dev') {
  console.log('개발 서버를 띄웁니다. 이 창을 닫으면 서버도 멈춥니다.');
  console.log('코드를 고치고 브라우저를 새로고침하면 바로 반영됩니다.\n');

  const srv = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), `--port=${PORT}`],
                    { cwd: ROOT, stdio: 'inherit' });
  setTimeout(() => openExternal(`http://localhost:${PORT}`), 1200);
  srv.on('exit', code => process.exit(code ?? 0));

} else if (mode === 'build') {
  const proc = spawn(process.execPath, [join(ROOT, 'tools/build.mjs')],
                     { cwd: ROOT, stdio: 'inherit' });
  proc.on('exit', async code => {
    if (code === 0) {
      console.log('\ndist/company-tycoon.html 이 배포물입니다.');
      console.log('의존성이 없어 그대로 더블클릭해 실행되고, 그냥 전달해도 열립니다.');
      openExternal(join(ROOT, 'dist'));
    } else {
      console.log('\n빌드에 실패했습니다. 위 메시지를 확인하세요.');
    }
    await waitEnter();
    process.exit(code ?? 0);
  });

} else {
  console.log('사용법: node tools/launch.mjs dev|build [--port=5173]');
  process.exit(1);
}
