import { useState } from 'react';
import { get, patch } from '../api';
import { useData } from '../useData';
import { rupees, timeAgo } from '../format';

const NEXT = { Placed: ['Accepted', 'Rejected'], Accepted: ['Preparing'], Preparing: ['Ready'], Ready: ['Collected'] };
const COLUMNS = ['Placed', 'Accepted', 'Preparing', 'Ready'];
const fetchQueue = async () => (await get('/staff/orders')).orders;
const poll = () => 4000;

export default function Queue() {
  const { data, error, refresh, mutate } = useData('staff-orders', fetchQueue, { interval: poll });
  const [msg, setMsg] = useState('');
  const orders = data || [];

  const move = async (o, status) => {
    setMsg('');
    // optimistic: move the card at once, the server confirms in the background
    mutate((list) => list.map((x) => (x.id === o.id ? { ...x, status } : x)).filter((x) => x.status !== 'Collected' && x.status !== 'Rejected'));
    try {
      await patch(`/orders/${o.id}/status`, { status });
    } catch (e) {
      setMsg(e.message);
    }
    refresh();
  };

  return (
    <div>
      <h1 className="page-title">Live orders</h1>
      {(msg || error) && <p className="error">{msg || error}</p>}
      {data && !orders.length && <p className="muted center">No active orders. New orders appear here automatically.</p>}
      <div className="board">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col);
          return (
            <section key={col} className="column">
              <h2>{col} <span className="count">{list.length}</span></h2>
              {list.map((o) => (
                <article key={o.id} className="card order-card">
                  <div className="row-between">
                    <strong className="token small">{o.token}</strong>
                    <span className="muted">{timeAgo(o.createdAt)}</span>
                  </div>
                  <ul className="lines">
                    {o.items.map((i) => <li key={i.itemId}>{i.quantity} × {i.name}</li>)}
                  </ul>
                  <div className="row-between muted">
                    <span>{o.slotLabel}</span>
                    <span>{rupees(o.total)}</span>
                  </div>
                  <div className="actions">
                    {(NEXT[o.status] || []).map((s) => (
                      <button key={s} className={s === 'Rejected' ? 'outline' : 'primary'} onClick={() => move(o, s)}>
                        {s === 'Rejected' ? 'Reject' : `Mark ${s}`}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
