import { describe, expect, it } from 'vitest';
import { cartLines, cartReducer, cartTotal } from './cart';

const samosa = { id: 's', name: 'Samosa', price: 15 };
const tea = { id: 't', name: 'Tea', price: 10.5 };

describe('cart', () => {
  it('adds items and increments quantity', () => {
    let s = cartReducer({}, { type: 'add', item: samosa });
    s = cartReducer(s, { type: 'add', item: samosa });
    expect(s.s.quantity).toBe(2);
  });

  it('removes a line when quantity drops to zero', () => {
    let s = cartReducer({}, { type: 'add', item: samosa });
    s = cartReducer(s, { type: 'setQty', id: 's', quantity: 0 });
    expect(s).toEqual({});
  });

  it('totals in paise to avoid floating-point errors', () => {
    let s = cartReducer({}, { type: 'add', item: { id: 'd', name: 'Dosa', price: 0.1 } });
    s = cartReducer(s, { type: 'setQty', id: 'd', quantity: 3 });
    expect(cartTotal(s)).toBe(0.3);
  });

  it('builds the checkout payload the backend expects', () => {
    let s = cartReducer({}, { type: 'add', item: samosa });
    s = cartReducer(s, { type: 'add', item: tea });
    expect(cartLines(s)).toEqual([
      { itemId: 's', quantity: 1, price: 15 },
      { itemId: 't', quantity: 1, price: 10.5 },
    ]);
  });

  it('clears the cart', () => {
    const s = cartReducer({ s: { item: samosa, quantity: 1 } }, { type: 'clear' });
    expect(s).toEqual({});
  });
});
