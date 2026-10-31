import { useCallback, useEffect, useState } from 'react';
import { del, get, post, put } from '../api';

const SAMPLE_CSV = [
  'item name,category,price,availability',
  'Paneer Tikka Roll,Snacks,70,yes',
  'Veg Spring Roll,Snacks,55,yes',
  'Tomato Soup,Starters,45,yes',
  'Iced Tea,Beverages,35,yes',
  'Rasmalai,Desserts,50,no',
].join('\n');

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV + '\n'], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'canteengo-sample-menu.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function MenuAdmin() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', price: '' });
  const [csv, setCsv] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [choices, setChoices] = useState({});
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const m = await get('/menu');
    setItems(m.categories.flatMap((c) => c.items.map((i) => ({ ...i, category: c.category }))));
    setDrafts((await get('/menu/drafts')).drafts);
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [load]);

  const run = (p) => p.then(load).catch((e) => setMsg(e.details?.join?.(', ') || e.message));

  const add = (e) => {
    e.preventDefault();
    run(post('/menu', { ...form, price: Number(form.price) })).then(() => setForm({ name: '', category: '', price: '' }));
  };
  const readFile = async (e) => {
    const f = e.target.files[0];
    if (f) setCsv(await f.text());
  };
  const upload = async () => {
    try {
      const r = await post('/menu/drafts/upload', { csv });
      setUploadErrors(r.errors);
      setMsg(`${r.drafts.length} draft(s) created. Review them before publishing.`);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };
  const publish = async () => {
    try {
      const r = await post('/menu/drafts/publish', { ids: drafts.map((d) => d.id), resolutions: choices });
      setMsg(r.unresolved.length ? `${r.unresolved.length} duplicate(s) need merge, replace or skip` : 'Published');
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div>
      <h2>Menu</h2>
      {msg && <p className="banner">{msg}</p>}
      <form onSubmit={add} className="inline">
        <input placeholder="Item name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
        <input type="number" min="0.01" step="0.01" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <button>Add item</button>
      </form>
      {items.map((i) => (
        <div key={i.id} className="row">
          <span>{i.name} <span className="muted">· {i.category} · ₹{i.price}</span></span>
          <span>
            <button onClick={() => run(put(`/menu/${i.id}`, { available: !i.available }))}>
              {i.available ? 'Mark unavailable' : 'Mark available'}
            </button>
            <button onClick={() => run(del(`/menu/${i.id}`))}>Delete</button>
          </span>
        </div>
      ))}

      <h2>Bulk upload (CSV)</h2>
      <p className="muted">
        Columns: item name, category, price, availability (yes/no). PDF upload is not available yet.{' '}
        <button type="button" className="link" onClick={downloadSample}>Download a sample CSV</button>
      </p>
      <input type="file" accept=".csv,text/csv" onChange={readFile} />
      <button disabled={!csv} onClick={upload}>Create drafts</button>
      {uploadErrors.map((e) => <p key={e.line} className="error">Line {e.line}: {e.reason}</p>)}
      {drafts.length > 0 && (
        <>
          <h3>Drafts</h3>
          {drafts.map((d) => (
            <div key={d.id} className="row">
              <span>{d.name} · {d.category} · ₹{d.price}</span>
              {d.duplicateOf && (
                <select value={choices[d.id] || ''} onChange={(e) => setChoices({ ...choices, [d.id]: e.target.value })}>
                  <option value="">Duplicate: choose…</option>
                  <option value="merge">Merge price</option>
                  <option value="replace">Replace</option>
                  <option value="skip">Skip</option>
                </select>
              )}
            </div>
          ))}
          <button onClick={publish}>Publish confirmed drafts</button>
        </>
      )}
    </div>
  );
}
