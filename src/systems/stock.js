import { $, rnd, won } from '../core/util.js';
import { toast } from '../ui/toast.js';

/* ── 주식 ────────────────────────────────────────────────── */
function tickStock(s) {
  s.market.forEach(c => {
    if (!c.listed || c.owned) return;
    const vol = c.curse > 0 ? rnd(-0.09, 0.01) : rnd(-0.028, 0.031);
    c.price = Math.max(10, Math.round(c.price * (1 + vol)));
  });
}

function buyStock(s, c, qty) {
  const cost = c.price * qty;
  if (s.co.cash < cost) return toast('자금이 부족합니다', 'bad');
  s.co.cash -= cost;
  const h = s.stock.holds[c.id] || { qty: 0, avg: 0 };
  h.avg = (h.avg * h.qty + cost) / (h.qty + qty); h.qty += qty;
  s.stock.holds[c.id] = h;
  toast(`${c.name} ${qty}주 매수`, 'good');
}

function sellStock(s, c, qty) {
  const h = s.stock.holds[c.id]; if (!h || h.qty < qty) return;
  s.co.cash += c.price * qty; h.qty -= qty;
  const pl = (c.price - h.avg) * qty;
  if (h.qty <= 0) delete s.stock.holds[c.id];
  toast(`${c.name} ${qty}주 매도 · 손익 ${pl >= 0 ? '+' : ''}${won(pl)}`, pl >= 0 ? 'good' : 'bad');
}

export { buyStock, sellStock, tickStock };
