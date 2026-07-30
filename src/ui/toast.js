import { S } from '../core/state.js';
import { $ } from '../core/util.js';

/* ── 알림 / 토스트 / 뉴스 ────────────────────────────────── */
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function news(t) { $('news-line').textContent = t; S.log.unshift({ d: S.day, t }); if (S.log.length > 60) S.log.pop(); }

function pushInbox(s, title, body, kind) {
  s.inbox.unshift({ id: Math.random().toString(36).slice(2), day: s.day, title, body, kind: kind || 'info', read: false });
  if (s.inbox.length > 40) s.inbox.pop();
  toast(title, kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : '');
}

export { news, pushInbox, toast };
