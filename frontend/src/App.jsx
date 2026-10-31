import { NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { cartCount, cartTotal, useCart } from './cart';
import { ACTIVE, OrdersProvider, useOrders } from './orders';
import { rupees } from './format';
import Login from './pages/Login';
import Menu from './pages/Menu';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import Queue from './pages/Queue';
import MenuAdmin from './pages/MenuAdmin';
import Setup from './pages/Setup';
import Owner from './pages/Owner';

const isStaff = (u) => u && (u.role === 'staff' || u.role === 'owner');

function TopBar({ user, logout, children }) {
  const initial = (user.name || user.email || '?').trim()[0].toUpperCase();
  return (
    <header className="topbar">
      <Link to="/" className="logo">Canteen<span>Go</span></Link>
      {children}
      <div className="user">
        <span className="avatar" title={user.email}>{initial}</span>
        <button className="link" onClick={logout}>Log out</button>
      </div>
    </header>
  );
}

// Shown on every student screen while an order is in progress, like a delivery-app tracker strip.
function ActiveOrderBar() {
  const { data } = useOrders();
  const { pathname } = useLocation();
  const order = (data || []).find((o) => ACTIVE.includes(o.status));
  if (!order || pathname === '/orders') return null;
  return (
    <Link to="/orders" className={'order-strip' + (order.status === 'Ready' ? ' ready' : '')}>
      <span>
        <strong>{order.status === 'Ready' ? 'Your order is ready!' : `Order ${order.token}`}</strong>
        <small> · {order.status}</small>
      </span>
      <span>Track ›</span>
    </Link>
  );
}

function CartBar() {
  const { state } = useCart();
  const { pathname } = useLocation();
  const count = cartCount(state);
  if (!count || pathname !== '/') return null;
  return (
    <Link to="/cart" className="cart-bar">
      <span><strong>{count} item{count > 1 ? 's' : ''}</strong> · {rupees(cartTotal(state))}</span>
      <span>View cart ›</span>
    </Link>
  );
}

function StudentApp({ user, logout }) {
  const { state } = useCart();
  const { data } = useOrders();
  const count = cartCount(state);
  const hasActive = (data || []).some((o) => ACTIVE.includes(o.status));
  return (
    <div className="shell student">
      <TopBar user={user} logout={logout} />
      <ActiveOrderBar />
      <main className="page">
        <Routes>
          <Route path="/" element={<Menu />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CartBar />
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/" end><span aria-hidden="true">🍽️</span>Menu</NavLink>
        <NavLink to="/orders"><span aria-hidden="true">🧾</span>Orders{hasActive && <i className="dot-badge" />}</NavLink>
        <NavLink to="/cart"><span aria-hidden="true">🛒</span>Cart{count > 0 && <i className="badge">{count}</i>}</NavLink>
      </nav>
    </div>
  );
}

function StaffApp({ user, logout }) {
  return (
    <div className="shell staff">
      <TopBar user={user} logout={logout}>
        <nav className="tabs" aria-label="Main">
          <NavLink to="/queue">Orders</NavLink>
          <NavLink to="/menu-admin">Menu</NavLink>
          <NavLink to="/setup">Slots &amp; offers</NavLink>
          {user.role === 'owner' && <NavLink to="/owner">Reports &amp; staff</NavLink>}
        </nav>
      </TopBar>
      <main className="page wide">
        <Routes>
          <Route path="/queue" element={<Queue />} />
          <Route path="/menu-admin" element={<MenuAdmin />} />
          <Route path="/setup" element={<Setup />} />
          {user.role === 'owner' && <Route path="/owner" element={<Owner />} />}
          <Route path="*" element={<Navigate to="/queue" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p className="center splash">Loading…</p>;
  if (!user) return <Login />;
  if (isStaff(user)) return <StaffApp user={user} logout={logout} />;
  return (
    <OrdersProvider>
      <StudentApp user={user} logout={logout} />
    </OrdersProvider>
  );
}
