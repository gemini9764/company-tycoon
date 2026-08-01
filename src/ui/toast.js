import { S } from '../core/state.js';
import { $, esc } from '../core/util.js';

/* ── 알림 / 토스트 / 뉴스 ────────────────────────────────── */
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* 지난 소식은 이미 S.log 에 60건까지 쌓인다. 그걸 그대로 펼쳐 보여 준다. */
let newsOpen = false;

function news(t) {
  S.log.unshift({ d: S.day, t });
  if (S.log.length > 60) S.log.pop();
  renderNews();
}

function toggleNews() { newsOpen = !newsOpen; renderNews(); }

function renderNews() {
  const line = $('news-line'), log = $('news-log'), btn = $('news-toggle');
  if (!line) return;
  const last = S && S.log[0];
  line.textContent = last ? last.t : '시장이 개장했습니다.';
  if (btn) btn.textContent = newsOpen ? '접기 ▲' : '지난 소식 ▼';
  if (!log) return;
  log.classList.toggle('on', newsOpen);
  if (!newsOpen) { log.innerHTML = ''; return; }
  log.innerHTML = (S && S.log.length)
    ? S.log.map(l => `<div class="news-row"><span>${l.d}일차</span><b>${esc(l.t)}</b></div>`).join('')
    : '<div class="empty">아직 소식이 없습니다</div>';
}

function pushInbox(s, title, body, kind) {
  s.inbox.unshift({ id: Math.random().toString(36).slice(2), day: s.day, title, body, kind: kind || 'info', read: false });
  if (s.inbox.length > 40) s.inbox.pop();
  toast(title, kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : '');
}

export { news, newsOpen, pushInbox, renderNews, toast, toggleNews };
