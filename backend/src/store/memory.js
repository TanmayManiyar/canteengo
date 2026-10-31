'use strict';
// In-memory store used by the tests. Same interface as store/mongo.js.
const crypto = require('crypto');

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}

function createMemoryStore() {
  const data = {};
  const map = (name) => (data[name] ||= new Map());

  function col(name) {
    const m = map(name);
    return {
      async insert(doc) {
        const id = doc.id || crypto.randomUUID();
        const d = { ...doc, id };
        m.set(id, d);
        return { ...d };
      },
      async get(id) {
        const d = m.get(id);
        return d ? { ...d } : null;
      },
      async findOne(filter) {
        for (const d of m.values()) if (matches(d, filter)) return { ...d };
        return null;
      },
      async find(filter) {
        return [...m.values()].filter((d) => matches(d, filter)).map((d) => ({ ...d }));
      },
      // Atomic conditional update: applies only if the doc matches `cond`.
      async update(id, patch, cond) {
        const d = m.get(id);
        if (!d || !matches(d, cond)) return null;
        Object.assign(d, patch);
        return { ...d };
      },
      async inc(id, fields) {
        const d = m.get(id);
        if (!d) return null;
        for (const [k, v] of Object.entries(fields)) d[k] = (d[k] || 0) + v;
        return { ...d };
      },
      async remove(id) {
        return m.delete(id);
      },
    };
  }

  return {
    col,
    // Creates the slot if it does not exist yet and returns it (never resets an existing slot's bookings).
    async ensureSlot(doc) {
      const m = map('slots');
      if (!m.has(doc.id)) m.set(doc.id, { ...doc });
      return { ...m.get(doc.id) };
    },
    // Atomic: only succeeds while reserved < capacity (REQ-11, no overbooking).
    async reserveSlot(id) {
      const d = map('slots').get(id);
      if (!d || d.reserved >= d.capacity) return null;
      d.reserved += 1;
      return { ...d };
    },
    async releaseSlot(id) {
      const d = map('slots').get(id);
      if (d && d.reserved > 0) d.reserved -= 1;
    },
    async close() {},
  };
}

module.exports = { createMemoryStore };
