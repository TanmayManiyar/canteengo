import { useState } from 'react';
import { useAuth } from '../AuthContext';

const MESSAGES = {
  'auth/invalid-credential': 'Wrong email or password. If you have not registered yet, click "New here? Register".',
  'auth/email-already-in-use': 'This email is already registered. Click "Have an account? Log in".',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'Network problem. Please check your connection.',
};
const friendly = (err) => MESSAGES[err.code] || err.message || 'Could not sign in';

export default function Login() {
  const { login, register, authError } = useAuth();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(f.email, f.password);
      else await register(f.name, f.email, f.password);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>CanteenGo</h1>
      <p className="muted">{mode === 'login' ? 'Log in to order' : 'Register with your college email'}</p>
      {mode === 'register' && <input placeholder="Name" value={f.name} onChange={set('name')} required />}
      <input type="email" placeholder="College email" value={f.email} onChange={set('email')} required />
      <input type="password" placeholder="Password" minLength={6} value={f.password} onChange={set('password')} required />
      {(error || authError) && <p className="error" role="alert">{error || authError}</p>}
      <button disabled={busy}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Register' : 'Have an account? Log in'}
      </button>
    </form>
  );
}
