// DEVELOPMENT ONLY: stands in for 'firebase/auth' when running `vite --mode mock`. Any password works.
// The token is "<uid>|<email>", which the mock backend (backend/scripts/dev-mock-server.js) accepts.
const KEY = 'mock-auth-email';
const listeners = new Set();

const makeUser = (email) => ({ email, uid: `fb:${email}`, displayName: '', getIdToken: async () => `fb:${email}|${email}` });
let current = (() => {
  try {
    const e = sessionStorage.getItem(KEY);
    return e ? makeUser(e) : null;
  } catch {
    return null;
  }
})();

const auth = {
  authStateReady: async () => {},
  get currentUser() {
    return current;
  },
};
const emit = () => listeners.forEach((cb) => cb(current));
const set = (email) => {
  current = email ? makeUser(email) : null;
  try {
    email ? sessionStorage.setItem(KEY, email) : sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
};

export const getAuth = () => auth;
export const onAuthStateChanged = (_auth, cb) => {
  listeners.add(cb);
  setTimeout(() => cb(current), 0);
  return () => listeners.delete(cb);
};
export const signInWithEmailAndPassword = async (_a, email) => {
  set(email.trim().toLowerCase());
  return { user: current };
};
export const createUserWithEmailAndPassword = signInWithEmailAndPassword;
export const signOut = async () => set(null);
