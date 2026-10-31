import { useEffect, useState } from 'react';
import { get } from '../api';
import { useData } from '../useData';

const RUSH = {
  low: { text: 'Not busy', cls: 'low' },
  moderate: { text: 'Moderately busy', cls: 'moderate' },
  busy: { text: 'Busy', cls: 'busy' },
  'very-busy': { text: 'Very busy', cls: 'very-busy' },
};
const MIN = 60_000;
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const nextQuarter = (ms) => Math.ceil(ms / (15 * MIN)) * 15 * MIN;

export const rushText = (level) => (RUSH[level] || RUSH.low).text;

export function RushBadge({ level, full }) {
  const r = full ? { text: 'Full', cls: 'very-busy' } : RUSH[level] || RUSH.low;
  return <span className={'rush ' + r.cls}><i aria-hidden="true" />{r.text}</span>;
}

/**
 * value: { key, pickup, label } | null.  onChange gets the same shape.
 * pickup is what the server expects: {type:'asap'} | {type:'slot', slotId} | {type:'custom', at}
 */
export default function PickupPicker({ value, onChange }) {
  const { data, loading, error, refresh } = useData('pickup', async () => get('/pickup/options'), { interval: 20_000 });
  const [day, setDay] = useState('today');
  const [clock, setClock] = useState('');
  const [custom, setCustom] = useState(null); // rush info for the typed time
  const [customError, setCustomError] = useState('');

  const customAt = (() => {
    if (!clock) return null;
    const [h, m] = clock.split(':').map(Number);
    const d = new Date();
    if (day === 'tomorrow') d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  })();

  // Look up the rush for the typed time (after a short pause while typing).
  useEffect(() => {
    if (customAt === null) {
      setCustom(null);
      return undefined;
    }
    setCustomError('');
    const id = setTimeout(async () => {
      try {
        const info = await get(`/pickup/rush?at=${customAt}`);
        setCustom(info);
        if (customAt < Date.now() + (data?.rules.leadMinutes ?? 10) * MIN) setCustomError(`Choose a time at least ${data?.rules.leadMinutes ?? 10} minutes from now.`);
        else if (!info.open) setCustomError('The canteen is closed at that time.');
        else if (info.full) setCustomError('That time is full. Please pick another.');
        else onChange({ key: 'custom', pickup: { type: 'custom', at: customAt }, label: `${timeOf(customAt)}`, rush: info });
      } catch (e) {
        setCustomError(e.message);
      }
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customAt]);

  if (!data) {
    return error ? <p className="error">{error}</p> : <div className="skeleton" aria-busy={loading} />;
  }

  const { now: rushNow, windows, rules } = data;
  const choose = (key, pickup, label, rush) => onChange({ key, pickup, label, rush });
  const windowFor = (at) => windows.find((w) => w.startsAt <= at && at < w.startsAt + 15 * MIN);
  const quick = [15, 30, 60].map((m) => {
    const at = nextQuarter(Date.now() + Math.max(m, rules.leadMinutes) * MIN);
    return { m, at, w: windowFor(at) };
  });

  return (
    <div className="pickup">
      <button
        className={'pick-card' + (value?.key === 'asap' ? ' selected' : '')}
        disabled={!rushNow.available}
        onClick={() => choose('asap', { type: 'asap' }, 'Right now', rushNow)}
        aria-pressed={value?.key === 'asap'}
      >
        <div className="pick-head">
          <strong>⚡ Right now</strong>
          {rushNow.available ? <RushBadge level={rushNow.level} /> : <span className="rush very-busy"><i />Closed</span>}
        </div>
        <div className="muted">
          {rushNow.available
            ? `${rushNow.activeOrders} order${rushNow.activeOrders === 1 ? '' : 's'} in progress · ${rushNow.activeUsers} ${rushNow.activeUsers === 1 ? 'person' : 'people'} ordering · about ${rushNow.waitMinutes} min wait`
            : 'The canteen is closed. Choose a later time.'}
        </div>
      </button>

      <h3 className="mini-title">Quick picks</h3>
      <div className="chip-row">
        {quick.map(({ m, at, w }) => (
          <button
            key={m}
            className={'time-chip' + (value?.key === `q${m}` ? ' selected' : '')}
            disabled={!w || w.full}
            onClick={() => choose(`q${m}`, w.slotId ? { type: 'slot', slotId: w.slotId } : { type: 'custom', at }, timeOf(at), w)}
          >
            <strong>{m === 60 ? 'In 1 hour' : `In ${m} min`}</strong>
            <span>{timeOf(at)}</span>
            {w && <RushBadge level={w.level} full={w.full} />}
          </button>
        ))}
      </div>

      <h3 className="mini-title">Pick a time</h3>
      {windows.length === 0 && <p className="muted">No pickup times are open right now.</p>}
      <div className="chip-row wrap">
        {windows.map((w) => (
          <button
            key={w.startsAt}
            className={'time-chip small' + (value?.key === `w${w.startsAt}` ? ' selected' : '')}
            disabled={w.full}
            onClick={() => choose(`w${w.startsAt}`, w.slotId ? { type: 'slot', slotId: w.slotId } : { type: 'custom', at: w.startsAt }, timeOf(w.startsAt), w)}
          >
            <strong>{timeOf(w.startsAt)}</strong>
            <RushBadge level={w.level} full={w.full} />
            <span>{w.full ? 'Full' : `${w.remaining} left`}</span>
          </button>
        ))}
      </div>

      <h3 className="mini-title">Or choose any time</h3>
      <div className={'custom-time' + (value?.key === 'custom' ? ' selected' : '')}>
        <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
        </select>
        <input type="time" step="900" value={clock} onChange={(e) => setClock(e.target.value)} aria-label="Pickup time" />
      </div>
      {custom && !customError && customAt !== null && (
        <p className="muted">At {timeOf(customAt)}: <RushBadge level={custom.level} full={custom.full} /> · {custom.remaining} spots left</p>
      )}
      {customError && <p className="error" role="alert">{customError}</p>}
      <button className="link" onClick={refresh}>Refresh rush</button>
    </div>
  );
}
