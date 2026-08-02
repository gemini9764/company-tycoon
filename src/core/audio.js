/* ══════════════════════════════════════════════════════════════
   AUDIO — 절차적 사운드

   프로젝트 원칙이 '외부 에셋 0' 이라 음원 파일을 두지 않는다. WebAudio 로
   사각파·삼각파를 직접 합성해 8비트 효과음과 배경음을 만든다.

   · 브라우저 자동재생 정책 때문에 AudioContext 는 **첫 사용자 제스처**에서만
     열 수 있다. 그래서 unlock() 을 클릭/키 입력에 물려 두고, 그전의 호출은
     조용히 무시한다.
   · jsdom 처럼 AudioContext 가 없는 환경에서는 전부 no-op 이 된다.
     (스모크 테스트가 사운드 때문에 터지지 않게 하기 위함)
   ══════════════════════════════════════════════════════════════ */

const SND = {
  master: 0.7, bgm: 0.45, sfx: 0.75, muted: false,
  ctx: null, gMaster: null, gBgm: null, gSfx: null,
  timer: null, step: 0, next: 0,
};

/** 설정 화면이 읽고 쓰는 값. 저장은 storage 쪽에서 이 객체를 그대로 직렬화한다. */
function soundPrefs() {
  return { master: SND.master, bgm: SND.bgm, sfx: SND.sfx, muted: SND.muted };
}

function setSoundPrefs(p) {
  if (!p) return;
  if (typeof p.master === 'number') SND.master = clamp01(p.master);
  if (typeof p.bgm === 'number') SND.bgm = clamp01(p.bgm);
  if (typeof p.sfx === 'number') SND.sfx = clamp01(p.sfx);
  if (typeof p.muted === 'boolean') SND.muted = p.muted;
  applyVolumes();
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 첫 사용자 제스처에서 호출. 두 번째부터는 아무 일도 하지 않는다. */
function unlockAudio() {
  if (SND.ctx) { if (SND.ctx.state === 'suspended') SND.ctx.resume(); return; }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;                                  // jsdom 등 — 조용히 포기
  try {
    SND.ctx = new AC();
    SND.gMaster = SND.ctx.createGain(); SND.gMaster.connect(SND.ctx.destination);
    SND.gBgm = SND.ctx.createGain(); SND.gBgm.connect(SND.gMaster);
    SND.gSfx = SND.ctx.createGain(); SND.gSfx.connect(SND.gMaster);
    applyVolumes();
  } catch { SND.ctx = null; }
}

function applyVolumes() {
  if (!SND.ctx) return;
  const m = SND.muted ? 0 : SND.master;
  SND.gMaster.gain.value = m;
  SND.gBgm.gain.value = SND.bgm * 0.34;             // 배경음은 효과음에 묻히지 않을 만큼만
  SND.gSfx.gain.value = SND.sfx;
}

/** 사각파 한 음. 짧은 어택·릴리즈로 클릭 노이즈를 막는다. */
function blip(freq, dur, type, peak, dest, at) {
  const c = SND.ctx;
  const t = at ?? c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

/* 효과음 사전 — [주파수, 길이, 파형, 세기] 의 나열. 순서대로 이어 붙인다. */
const SFX = {
  tap:   [[660, 0.05, 'square', 0.18]],
  open:  [[520, 0.06, 'square', 0.16], [780, 0.08, 'square', 0.14]],
  close: [[600, 0.05, 'square', 0.13], [400, 0.07, 'square', 0.11]],
  coin:  [[988, 0.05, 'square', 0.20], [1319, 0.12, 'square', 0.16]],
  good:  [[523, 0.07, 'square', 0.18], [659, 0.07, 'square', 0.18], [784, 0.16, 'square', 0.16]],
  bad:   [[311, 0.10, 'square', 0.20], [233, 0.20, 'square', 0.18]],
  alert: [[880, 0.07, 'triangle', 0.20], [880, 0.07, 'triangle', 0.20]],
};

function sfx(name) {
  if (!SND.ctx || SND.muted || !SFX[name]) return;
  let t = SND.ctx.currentTime;
  for (const [f, d, w, p] of SFX[name]) { blip(f, d, w, p, SND.gSfx, t); t += d * 0.8; }
}

/* ── 배경음 ──────────────────────────────────────────────────
   4마디 코드 진행 위에 아르페지오를 얹는다. 미리 다 스케줄하면 볼륨 변경이
   늦게 먹으므로, 짧은 룩어헤드로 조금씩 예약한다(WebAudio 표준 패턴).
   ─────────────────────────────────────────────────────────── */
const CHORDS = [
  [262, 330, 392, 523],   // C
  [220, 262, 330, 440],   // Am
  [175, 220, 262, 349],   // F
  [196, 247, 294, 392],   // G
];
const STEP = 0.26;                                  // 8분음표 길이(초)

function scheduleBgm() {
  const c = SND.ctx;
  if (!c) return;
  while (SND.next < c.currentTime + 0.4) {
    const bar = Math.floor(SND.step / 8) % 4;
    const ch = CHORDS[bar], i = SND.step % 8;
    blip(ch[[0, 2, 1, 3, 2, 1, 3, 2][i]], 0.22, 'square', 0.055, SND.gBgm, SND.next);
    if (i % 4 === 0) blip(ch[0] / 2, 0.42, 'triangle', 0.13, SND.gBgm, SND.next);
    SND.step++; SND.next += STEP;
  }
}

function startBgm() {
  if (!SND.ctx || SND.timer) return;
  SND.next = SND.ctx.currentTime + 0.1;
  SND.timer = setInterval(scheduleBgm, 120);
  scheduleBgm();
}

function stopBgm() {
  if (SND.timer) { clearInterval(SND.timer); SND.timer = null; }
}

export { SND, SFX, applyVolumes, scheduleBgm, setSoundPrefs, sfx, soundPrefs, startBgm, stopBgm, unlockAudio };
