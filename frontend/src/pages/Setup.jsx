import { useState } from 'react';
import { post } from '../api';

const ms = (v) => new Date(v).getTime();

export default function Setup() {
  const [slot, setSlot] = useState({ label: '', capacity: 10, startsAt: '' });
  const [offer, setOffer] = useState({ title: '', description: '', startsAt: '', endsAt: '' });
  const [msg, setMsg] = useState('');
  const go = (p, ok) => p.then(() => setMsg(ok)).catch((e) => setMsg(e.details?.join?.(', ') || e.message));

  return (
    <div>
      {msg && <p className="banner">{msg}</p>}
      <h2>New pickup slot</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          go(post('/slots', { label: slot.label, capacity: Number(slot.capacity), startsAt: ms(slot.startsAt) }), 'Slot created');
        }}
      >
        <input placeholder="Label, e.g. 1:00–1:15" value={slot.label} onChange={(e) => setSlot({ ...slot, label: e.target.value })} required />
        <input type="number" min="1" value={slot.capacity} onChange={(e) => setSlot({ ...slot, capacity: e.target.value })} required />
        <input type="datetime-local" value={slot.startsAt} onChange={(e) => setSlot({ ...slot, startsAt: e.target.value })} required />
        <button>Create slot</button>
      </form>
      <h2>New daily offer</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          go(
            post('/offers', {
              title: offer.title,
              description: offer.description || undefined,
              startsAt: ms(offer.startsAt),
              endsAt: ms(offer.endsAt),
            }),
            'Offer published'
          );
        }}
      >
        <input placeholder="Title" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} required />
        <input placeholder="Description" value={offer.description} onChange={(e) => setOffer({ ...offer, description: e.target.value })} />
        <input type="datetime-local" value={offer.startsAt} onChange={(e) => setOffer({ ...offer, startsAt: e.target.value })} required />
        <input type="datetime-local" value={offer.endsAt} onChange={(e) => setOffer({ ...offer, endsAt: e.target.value })} required />
        <button>Publish offer</button>
      </form>
    </div>
  );
}
