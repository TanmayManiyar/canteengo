import { useEffect, useState } from 'react';
import { get, put } from '../api';

export default function Owner() {
  const [sales, setSales] = useState(null);
  const [fb, setFb] = useState(null);
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState('');
  const loadUsers = () => get('/admin/users').then((r) => setUsers(r.users));

  useEffect(() => {
    Promise.all([get('/reports/sales').then(setSales), get('/reports/feedback').then(setFb), loadUsers()]).catch((e) =>
      setMsg(e.message)
    );
  }, []);

  const setRole = (id, role) => put(`/admin/users/${id}/role`, { role }).then(loadUsers).catch((e) => setMsg(e.message));

  return (
    <div>
      {msg && <p className="error">{msg}</p>}
      <h2>Sales</h2>
      {sales && (
        <>
          <p><strong>₹{sales.totalRevenue}</strong> from {sales.orderCount} orders</p>
          {sales.topItems.slice(0, 5).map((i) => (
            <div key={i.itemId} className="row"><span>{i.name}</span><span>{i.quantity} sold · ₹{i.revenue}</span></div>
          ))}
        </>
      )}
      <h2>Feedback</h2>
      {fb && (
        <>
          <p>{fb.count} ratings · average {fb.average ?? '–'}</p>
          {fb.items.map((i) => (
            <div key={i.id} className="row"><span>{i.name}</span><span>★ {i.average} ({i.count})</span></div>
          ))}
        </>
      )}
      <h2>Staff access</h2>
      {users.filter((u) => u.role !== 'owner').map((u) => (
        <div key={u.id} className="row">
          <span>{u.email} <span className="muted">· {u.role}</span></span>
          {u.role === 'staff' ? (
            <button onClick={() => setRole(u.id, 'student')}>Revoke staff</button>
          ) : (
            <button onClick={() => setRole(u.id, 'staff')}>Make staff</button>
          )}
        </div>
      ))}
    </div>
  );
}
