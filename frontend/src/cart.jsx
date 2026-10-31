import { createContext, useContext, useEffect, useReducer } from 'react';

const Ctx = createContext(null);
export const useCart = () => useContext(Ctx);

export const MAX_QTY = 10; // matches the backend limit per item

// REQ-6: the cart is held client-side until checkout.
export function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const cur = state[action.item.id];
      const quantity = Math.min((cur?.quantity || 0) + 1, MAX_QTY);
      return { ...state, [action.item.id]: { item: action.item, quantity } };
    }
    case 'setQty': {
      if (action.quantity <= 0) {
        const { [action.id]: _removed, ...rest } = state;
        return rest;
      }
      return { ...state, [action.id]: { ...state[action.id], quantity: Math.min(action.quantity, MAX_QTY) } };
    }
    case 'sync': {
      // Refresh prices/availability from the latest menu; drop items that no longer exist.
      const byId = new Map(action.items.map((i) => [i.id, i]));
      const next = {};
      for (const [id, line] of Object.entries(state)) {
        const fresh = byId.get(id);
        if (fresh) next[id] = { item: fresh, quantity: line.quantity };
      }
      return next;
    }
    case 'clear':
      return {};
    default:
      return state;
  }
}

export const cartLines = (state) =>
  Object.values(state).map((l) => ({ itemId: l.item.id, quantity: l.quantity, price: l.item.price }));
export const cartTotal = (state) =>
  Object.values(state).reduce((s, l) => s + Math.round(l.item.price * 100) * l.quantity, 0) / 100;
export const cartCount = (state) => Object.values(state).reduce((s, l) => s + l.quantity, 0);

const KEY = 'cg:cart';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}
