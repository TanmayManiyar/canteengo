import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';
import { get, post } from './api';
import { clearCache, readCache, writeCache } from './useData';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  // The last known user is shown immediately on reload and re-checked with the server in the background.
  const [user, setUser] = useState(() => readCache('user'));
  const [loading, setLoading] = useState(() => readCache('user') === null);
  const [authError, setAuthError] = useState('');

  const apply = (u) => {
    setUser(u);
    writeCache('user', u);
  };

  useEffect(
    () =>
      onAuthStateChanged(auth, async (fb) => {
        setAuthError('');
        if (!fb) {
          setUser(null);
          clearCache();
          setLoading(false);
          return;
        }
        try {
          apply(await get('/me'));
        } catch (e) {
          if (e.status === 403) {
            // Signed in with Firebase but the backend has no record yet (e.g. an interrupted sign-up).
            try {
              apply(await post('/auth/register', { name: fb.displayName || '' }));
            } catch (e2) {
              setUser(null);
              setAuthError(e2.message);
              await signOut(auth);
            }
          } else if (!readCache('user')) {
            setAuthError(e.message); // e.g. backend unreachable and nothing cached
          }
        }
        setLoading(false);
      }),
    []
  );

  const value = {
    user,
    loading,
    authError,
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    async register(name, email, password) {
      await createUserWithEmailAndPassword(auth, email, password);
      apply(await post('/auth/register', { name })); // backend enforces the college email rule
    },
    async logout() {
      post('/auth/logout').catch(() => {}); // REQ-4: revoke the session server-side without making the user wait
      await signOut(auth);
      clearCache();
      localStorage.removeItem('cg:cart');
      setUser(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
