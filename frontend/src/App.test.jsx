import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const MENU = {
  categories: [
    {
      category: 'Snacks',
      items: [
        { id: 's1', name: 'Samosa', category: 'Snacks', price: 15, available: true, avgRating: 4.2 },
        { id: 's2', name: 'Vada Pav', category: 'Snacks', price: 20, available: true, avgRating: null },
      ],
    },
    { category: 'Beverages', items: [{ id: 'b1', name: 'Masala Chai', category: 'Beverages', price: 10.5, available: false }] },
  ],
  offers: [{ id: 'o1', title: 'Chai Time', description: 'Both for less' }],
};

vi.mock('./firebase', () => ({ auth: { authStateReady: async () => {}, currentUser: null } }));
vi.mock('./api', () => ({
  get: vi.fn(async (path) => {
    if (path === '/menu') return { categories: MENU.categories };
    if (path === '/offers') return { offers: MENU.offers };
    if (path === '/orders') return { orders: [] };
    if (path === '/slots') return { slots: [] };
    return {};
  }),
  post: vi.fn(async () => ({})),
}));
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'stu@ves.ac.in', name: 'Stu', role: 'student' }, loading: false, logout: vi.fn() }),
}));

import App from './App';
import { CartProvider } from './cart';

const renderApp = () =>
  render(
    <MemoryRouter>
      <CartProvider>
        <App />
      </CartProvider>
    </MemoryRouter>
  );

describe('student app', () => {
  beforeEach(() => localStorage.clear());

  it('shows the menu, turns ADD into a stepper and shows the cart bar', async () => {
    renderApp();
    await screen.findByText('Samosa');
    fireEvent.click(screen.getByRole('button', { name: /add samosa/i }));
    expect(await screen.findByRole('group', { name: /samosa quantity/i })).toBeInTheDocument();
    expect(screen.getByText(/1 item/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add one more samosa/i }));
    await waitFor(() => expect(screen.getByText(/2 items/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /remove one samosa/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove one samosa/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /add samosa/i })).toBeInTheDocument());
  });

  it('opens the cart page with items from the menu', async () => {
    renderApp();
    await screen.findByText('Vada Pav');
    fireEvent.click(screen.getByRole('button', { name: /add vada pav/i }));
    fireEvent.click(await screen.findByText(/view cart/i));
    expect(await screen.findByText('Your cart')).toBeInTheDocument();
    expect(screen.getByText('Bill details')).toBeInTheDocument();
  });
});

describe('plain-HTTP pages (no crypto.randomUUID)', () => {
  it('still renders the cart page', async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      localStorage.clear();
      renderApp();
      await screen.findByText('Samosa');
      fireEvent.click(screen.getByRole('button', { name: /add samosa/i }));
      fireEvent.click(await screen.findByText(/view cart/i));
      expect(await screen.findByText('Bill details')).toBeInTheDocument();
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
