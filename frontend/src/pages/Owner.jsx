import { useEffect, useState } from 'react';
import { del, get, post } from '../api';
import { useData } from '../useData';
import { rupees } from '../format';

const PAGE = 5;

function Fold({ title, hint, defaultOpen = false, onOpen, children }) {
  return (
    <details className="fold" open={defaultOpen} onToggle={(e) => e.currentTarget.open && onOpen?.()}>
      <summary>
        <span>{title}</span>
        {hint && <span className="muted">{hint}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

// One-time password card: shown after creating a login or resetting a password, never stored.
function Credentials({ info, onClose }) {
  const [copied, setCopied] = useState(false);
  const text = `CanteenGo login\nEmail: ${info.email}\nPassword: ${info.password}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      window.prompt('Copy these login details:', text);
    }
  };
  return (
    <div className="cred-card" role="status">
      <strong>{info.title}</strong>
      <div>Email: <code>{info.email}</code></div>
      <div>Password: <code>{info.password}</code></div>
      <p className="muted">Shown only once. Copy it now and give it to the staff member; they can use it to log in right away.</p>
      <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy login details'}</button>
      <button className="link" onClick={onClose}>Done</button>
    </div>
  );
}

function CreateStaff({ onCreated }) {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await post('/admin/staff', { name: f.name, email: f.email, password: f.password || undefined });
      setF({ name: '', email: '', password: '' });
      onCreated({ title: `Login created for ${r.name}`, email: r.email, password: r.password });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="inline" onSubmit={submit}>
      <input placeholder="Full name" value={f.name} onChange={set('name')} required />
      <input type="email" placeholder="Staff email (this is their login)" value={f.email} onChange={set('email')} required />
      <input type="text" placeholder="Password (leave empty to generate one)" minLength={8} value={f.password} onChange={set('password')} autoComplete="off" />
      {err && <p className="error" role="alert">{err}</p>}
      <button disabled={busy}>{busy ? 'Creating…' : 'Create staff login'}</button>
    </form>
  );
}

// Searchable list that only loads when opened, and shows a few accounts at a time.
function Accounts({ role, manage, refreshKey, onCredentials, onChanged }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // id awaiting "yes, remove"

  const load = async (offset, replace) => {
    setLoading(true);
    try {
      const r = await get(`/admin/users?role=${role}&q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`);
      setRows((prev) => (replace ? r.users : [...prev, ...r.users]));
      setTotal(r.total);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => load(0, true), q ? 300 : 0); // wait while typing
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, refreshKey]);

  const reset = async (u) => {
    try {
      const r = await post(`/admin/staff/${u.id}/reset-password`);
      onCredentials({ title: `New password for ${u.name || u.email}`, email: r.email, password: r.password });
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async (u) => {
    try {
      await del(`/admin/staff/${u.id}`);
      setConfirm(null);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <input type="search" placeholder={`Search ${role}s by name or email`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${role}s`} />
      {error && <p className="error">{error}</p>}
      {rows.map((u) => (
        <div key={u.id} className="account">
          <div className="grow">
            <strong>{u.name || '(no name)'}</strong>
            <div className="muted">{u.email}</div>
          </div>
          {manage && (confirm === u.id ? (
            <span className="confirm">
              Remove this login?
              <button onClick={() => remove(u)}>Yes, remove</button>
              <button className="link" onClick={() => setConfirm(null)}>Cancel</button>
            </span>
          ) : (
            <span>
              <button className="outline" onClick={() => reset(u)}>Reset password</button>
              <button className="outline danger" onClick={() => setConfirm(u.id)}>Remove</button>
            </span>
          ))}
        </div>
      ))}
      {!loading && rows.length === 0 && <p className="muted">{q ? 'No matching accounts.' : `No ${role} accounts yet.`}</p>}
      {loading && <p className="muted">Loading…</p>}
      {rows.length > 0 && (
        <div className="row-between">
          <span className="muted">Showing {rows.length} of {total}</span>
          {rows.length < total && <button className="outline" onClick={() => load(rows.length, false)} disabled={loading}>Show more</button>}
        </div>
      )}
    </div>
  );
}

export default function Owner() {
  const sales = useData('report-sales', () => get('/reports/sales'));
  const fb = useData('report-feedback', () => get('/reports/feedback'));
  const [credentials, setCredentials] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [opened, setOpened] = useState({ staff: false, students: false });
  const open = (k) => () => setOpened((o) => ({ ...o, [k]: true }));

  return (
    <div>
      <h1 className="page-title">Reports &amp; accounts</h1>
      {(sales.error || fb.error) && <p className="error">{sales.error || fb.error}</p>}

      <Fold title="Sales" defaultOpen hint={sales.data ? `${rupees(sales.data.totalRevenue)} · ${sales.data.orderCount} orders` : ''}>
        {sales.data?.topItems.slice(0, 5).map((i) => (
          <div key={i.itemId} className="row"><span>{i.name}</span><span>{i.quantity} sold · {rupees(i.revenue)}</span></div>
        ))}
        {sales.data && !sales.data.topItems.length && <p className="muted">No sales yet.</p>}
      </Fold>

      <Fold title="Customer feedback" hint={fb.data ? `${fb.data.count} ratings · average ${fb.data.average ?? '–'}` : ''}>
        {fb.data?.items.slice(0, 8).map((i) => (
          <div key={i.id} className="row"><span>{i.name}</span><span>★ {i.average} ({i.count})</span></div>
        ))}
        {fb.data && !fb.data.items.length && <p className="muted">No ratings yet.</p>}
      </Fold>

      <Fold title="Staff accounts" hint="create, reset password, remove" onOpen={open('staff')}>
        {credentials && <Credentials info={credentials} onClose={() => setCredentials(null)} />}
        <button className={showCreate ? 'outline' : 'primary'} onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Close' : '+ Create a new staff login'}
        </button>
        {showCreate && (
          <CreateStaff onCreated={(info) => { setCredentials(info); setShowCreate(false); setRefreshKey((k) => k + 1); }} />
        )}
        {opened.staff && (
          <Accounts role="staff" manage refreshKey={refreshKey} onCredentials={setCredentials} onChanged={() => setRefreshKey((k) => k + 1)} />
        )}
      </Fold>

      <Fold title="Student accounts" hint="view only" onOpen={open('students')}>
        {opened.students && <Accounts role="student" refreshKey={0} />}
      </Fold>
    </div>
  );
}
