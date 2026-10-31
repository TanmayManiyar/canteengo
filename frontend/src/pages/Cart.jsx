import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { useData } from '../useData';
import { cartLines, cartTotal, useCart } from '../cart';
import { useOrders } from '../orders';
import { emojiFor, rupees, uuid } from '../format';
import Stepper from '../components/Stepper';

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.body.appendChild(s);
  });
}

export default function Cart() {
  const { state, dispatch } = useCart();
  const { refresh: refreshOrders } = useOrders();
  const nav = useNavigate();
  const { data: slotData, refresh: refreshSlots } = useData('slots', async () => (await get('/slots')).slots);
  const [slotId, setSlotId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);
  // One idempotency key per checkout attempt, reused if the same attempt is retried (REQ-18).
  const attempt = useRef(uuid());
  const lines = Object.values(state);
  const total = cartTotal(state);
  const slots = slotData || [];

  const done = async () => {
    dispatch({ type: 'clear' });
    attempt.current = uuid();
    await refreshOrders();
    nav('/orders');
  };

  // The server re-validates the cart (REQ-9/11). If something changed, refresh the cart from the live menu.
  async function resync() {
    try {
      const menu = await get('/menu');
      dispatch({ type: 'sync', items: menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, category: c.category }))) });
    } catch {
      /* the message below still explains what happened */
    }
    refreshSlots();
  }

  async function pay() {
    setBusy(true);
    setMsg('');
    try {
      const s = await post('/checkout', { items: cartLines(state), slotId, idempotencyKey: attempt.current });
      if (s.demo) {
        setDemo(s); // classroom demo: no real gateway, the student confirms on this screen
        return;
      }
      await loadRazorpay();
      await new Promise((resolve, reject) => {
        const rz = new window.Razorpay({
          key: s.keyId,
          order_id: s.gatewayOrderId,
          amount: Math.round(s.amount * 100),
          currency: 'INR',
          name: 'CanteenGo',
          handler: async (resp) => {
            try {
              // The server re-checks this payment with the gateway before creating the order.
              const r = await post(`/payments/${s.paymentId}/confirm`, { gatewayPaymentId: resp.razorpay_payment_id });
              if (r.status === 'Success') await done();
              else setMsg(`Payment status: ${r.status}. Please try again.`);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          modal: { ondismiss: () => resolve() },
        });
        rz.on('payment.failed', () => {
          attempt.current = uuid(); // REQ-16: a failed attempt can be retried
          setMsg('Payment failed. No order was created; please try again.');
          resolve();
        });
        rz.open();
      });
    } catch (e) {
      if (e.status === 409) {
        attempt.current = uuid();
        await resync();
        setMsg(`${e.message}. We updated your cart${e.details?.length ? ` (${e.details.join('; ')})` : ''}. Please review and try again.`);
      } else setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function demoPay(outcome) {
    setBusy(true);
    setMsg('');
    try {
      const { gatewayPaymentId } = await post(`/payments/${demo.paymentId}/demo-pay`, { outcome });
      const r = await post(`/payments/${demo.paymentId}/confirm`, { gatewayPaymentId });
      setDemo(null);
      attempt.current = uuid();
      if (r.status === 'Success') await done();
      else setMsg('Payment failed. No order was created; you can try again.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (demo) {
    return (
      <div className="card pay-card">
        <h2>Complete payment</h2>
        <p className="muted">Demo mode: no real money is charged.</p>
        <p className="big">{rupees(demo.amount)}</p>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="primary block" disabled={busy} onClick={() => demoPay('success')}>
          {busy ? 'Processing…' : `Pay ${rupees(demo.amount)}`}
        </button>
        <button className="link" disabled={busy} onClick={() => demoPay('failed')}>Simulate a failed payment</button>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">🛒</div>
        <h2>Your cart is empty</h2>
        <p className="muted">Add something tasty from the menu.</p>
        <Link className="primary" to="/">Browse menu</Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Your cart</h1>
      <section className="card">
        {lines.map(({ item, quantity }) => (
          <div key={item.id} className="cart-line">
            <span className="mini-tile" aria-hidden="true">{emojiFor(item)}</span>
            <div className="grow">
              <strong>{item.name}</strong>
              <div className="muted">{rupees(item.price)}</div>
            </div>
            <Stepper
              qty={quantity}
              label={item.name}
              onAdd={() => dispatch({ type: 'setQty', id: item.id, quantity: quantity + 1 })}
              onSub={() => dispatch({ type: 'setQty', id: item.id, quantity: quantity - 1 })}
            />
            <div className="line-total">{rupees(Math.round(item.price * 100) * quantity / 100)}</div>
          </div>
        ))}
      </section>

      <h2 className="section-title">Pickup time</h2>
      {slots.length === 0 && <p className="muted">No pickup slots are open right now.</p>}
      <div className="slot-grid" role="radiogroup" aria-label="Pickup slot">
        {slots.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={slotId === s.id}
            className={'slot' + (slotId === s.id ? ' selected' : '')}
            onClick={() => setSlotId(s.id)}
          >
            <strong>{s.label}</strong>
            <span>{s.remaining} left</span>
          </button>
        ))}
      </div>

      <h2 className="section-title">Bill details</h2>
      <section className="card bill">
        <div><span>Item total</span><span>{rupees(total)}</span></div>
        <div><span>Taxes &amp; fees</span><span>₹0</span></div>
        <div className="bill-total"><span>To pay</span><span>{rupees(total)}</span></div>
      </section>

      {msg && <p className="error" role="alert">{msg}</p>}
      <div className="pay-bar">
        <button className="primary block" disabled={!slotId || busy} onClick={pay}>
          {busy ? 'Please wait…' : slotId ? `Pay ${rupees(total)}` : 'Choose a pickup time'}
        </button>
      </div>
    </div>
  );
}
