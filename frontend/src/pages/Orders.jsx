import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api';
import { ACTIVE, useOrders } from '../orders';
import { rupees, timeAgo } from '../format';

const STEPS = ['Placed', 'Accepted', 'Preparing', 'Ready', 'Collected'];
const MESSAGE = {
  Placed: 'Waiting for the canteen to accept your order',
  Accepted: 'The canteen accepted your order',
  Preparing: 'Your food is being prepared',
  Ready: 'Ready for pickup! Show your token at the counter',
};
const CANCEL_WINDOW_MS = 2 * 60 * 1000;

const summary = (o) => o.items.map((i) => `${i.quantity} × ${i.name}`).join(', ');

function Tracker({ status }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="tracker" aria-label="Order progress">
      {STEPS.slice(0, 4).map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}>
          <span className="dot">{i < at ? '✓' : i + 1}</span>
          <span className="step-name">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function ActiveOrder({ o, onChanged }) {
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const left = Math.max(0, CANCEL_WINDOW_MS - (now - o.createdAt));
  const canCancel = o.status === 'Placed' && left > 0;

  useEffect(() => {
    if (!canCancel) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [canCancel]);

  const cancel = async () => {
    try {
      await post(`/orders/${o.id}/cancel`);
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  };
  const mm = String(Math.floor(left / 60000));
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');

  return (
    <article className={'card active-order' + (o.status === 'Ready' ? ' ready' : '')}>
      <div className="token-row">
        <div>
          <div className="muted">Pickup token</div>
          <div className="token">{o.token}</div>
        </div>
        <span className={'pill ' + o.status.toLowerCase()}>{o.status}</span>
      </div>
      <p className="status-msg">{MESSAGE[o.status]}</p>
      <Tracker status={o.status} />
      <div className="muted">{summary(o)}</div>
      <div className="row-between">
        <span>{o.slotLabel}</span>
        <strong>{rupees(o.total)}</strong>
      </div>
      {canCancel && <button className="outline" onClick={cancel}>Cancel order ({mm}:{ss} left)</button>}
      {err && <p className="error">{err}</p>}
    </article>
  );
}

function PastOrder({ o, onRated }) {
  const [msg, setMsg] = useState('');
  const rate = async (rating) => {
    try {
      await post(`/orders/${o.id}/feedback`, { rating });
      onRated(o.id);
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <article className="card past">
      <div className="row-between">
        <strong>{o.token}</strong>
        <span className={'pill ' + o.status.toLowerCase()}>{o.status}</span>
      </div>
      <div className="muted">{summary(o)}</div>
      <div className="row-between">
        <span className="muted">{timeAgo(o.createdAt)}</span>
        <strong>{rupees(o.total)}</strong>
      </div>
      {o.status === 'Collected' && !o.rated && (
        <div className="rate">
          Rate this order:{' '}
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className="star" onClick={() => rate(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
          ))}
        </div>
      )}
      {o.rated && <div className="muted">Thanks for your feedback ★</div>}
      {msg && <p className="error">{msg}</p>}
    </article>
  );
}

export default function Orders() {
  const { data, error, loading, refresh, mutate } = useOrders();
  const orders = data || [];
  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const past = orders.filter((o) => !ACTIVE.includes(o.status));

  return (
    <div>
      <h1 className="page-title">Your orders</h1>
      {error && <p className="banner">{error}</p>}
      {loading && !data && <div className="skeleton tall" aria-busy="true" />}

      {active.length > 0 && <h2 className="section-title">Current order</h2>}
      {active.map((o) => <ActiveOrder key={o.id} o={o} onChanged={refresh} />)}

      {past.length > 0 && <h2 className="section-title">Past orders</h2>}
      {past.map((o) => (
        <PastOrder key={o.id} o={o} onRated={(id) => mutate((list) => list.map((x) => (x.id === id ? { ...x, rated: true } : x)))} />
      ))}

      {data && !orders.length && (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">🧾</div>
          <h2>No orders yet</h2>
          <Link className="primary" to="/">Order something</Link>
        </div>
      )}
    </div>
  );
}
