import { createContext, useContext } from 'react';
import { get } from './api';
import { useData } from './useData';

export const ACTIVE = ['Placed', 'Accepted', 'Preparing', 'Ready'];

const Ctx = createContext(null);
export const useOrders = () => useContext(Ctx);

const fetchOrders = async () => (await get('/orders')).orders;
// A status change must show within 5 s (SRS 3.4): poll every 4 s, but only while an order is active.
const poll = (orders) => (orders && orders.some((o) => ACTIVE.includes(o.status)) ? 4000 : 0);

export function OrdersProvider({ children }) {
  const value = useData('orders', fetchOrders, { interval: poll });
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
