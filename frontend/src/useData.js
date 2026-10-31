import { useCallback, useEffect, useRef, useState } from 'react';

// Stale-while-revalidate: show the last known data instantly (memory, then localStorage), refresh in the
// background, and optionally poll. This hides most network latency from the user.
const mem = new Map();
const PREFIX = 'cg:';

export const readCache = (key) => {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const v = raw === null ? null : JSON.parse(raw);
    if (v !== null) mem.set(key, v);
    return v;
  } catch {
    return null;
  }
};

export const writeCache = (key, value) => {
  mem.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: memory cache only */
  }
};

// Called on logout so the next person on a shared device never sees someone else's data.
export function clearCache() {
  mem.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * @param key      cache key
 * @param fetcher  async () => data
 * @param options  { interval: ms | (data) => ms (0 = no polling), enabled }
 */
export function useData(key, fetcher, { interval = 0, enabled = true } = {}) {
  const [data, setData] = useState(() => readCache(key));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => readCache(key) === null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const v = await fetcherRef.current();
      writeCache(key, v);
      setData(v);
      setError('');
      return v;
    } catch (e) {
      setError(e.message || 'Something went wrong');
      return undefined;
    } finally {
      setLoading(false);
      setTick((t) => t + 1);
    }
  }, [key]);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  // Refresh when the user comes back to the tab.
  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, refresh]);

  // Polling only while the tab is visible, and only when `interval` asks for it.
  useEffect(() => {
    if (!enabled) return undefined;
    const ms = typeof interval === 'function' ? interval(data) : interval;
    if (!ms) return undefined;
    const id = setTimeout(() => {
      if (document.visibilityState === 'visible') refresh();
      else setTick((t) => t + 1);
    }, ms);
    return () => clearTimeout(id);
  }, [enabled, interval, data, tick, refresh]);

  const mutate = useCallback(
    (v) => {
      const next = typeof v === 'function' ? v(readCache(key)) : v;
      writeCache(key, next);
      setData(next);
    },
    [key]
  );

  return { data, error, loading, refresh, mutate };
}
