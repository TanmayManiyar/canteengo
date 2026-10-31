import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const users = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Student ${i}`, email: `student${i}@ves.ac.in`, role: 'student' }));
const staff = [{ id: 'f1', name: 'Meera K', email: 'meera@ves.ac.in', role: 'staff' }];

vi.mock('../firebase', () => ({ auth: { authStateReady: async () => {}, currentUser: null } }));
vi.mock('../api', () => ({
  get: vi.fn(async (path) => {
    if (path.startsWith('/reports/sales')) return { orderCount: 3, totalRevenue: 90, topItems: [{ itemId: 'a', name: 'Samosa', quantity: 4, revenue: 60 }] };
    if (path.startsWith('/reports/feedback')) return { count: 1, average: 4, items: [] };
    const u = new URL('http://x' + path);
    const role = u.searchParams.get('role');
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const pool = (role === 'staff' ? staff : users).filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(q));
    const offset = Number(u.searchParams.get('offset') || 0);
    return { total: pool.length, users: pool.slice(offset, offset + Number(u.searchParams.get('limit') || 5)) };
  }),
  post: vi.fn(async (path, body) => (path === '/admin/staff' ? { id: 'n1', name: body.name, email: body.email, role: 'staff', password: 'Abcd2345Xy' } : {})),
  del: vi.fn(async () => null),
}));

import Owner from './Owner';

describe('owner accounts screen', () => {
  beforeEach(() => localStorage.clear());

  it('does not load or show student accounts until the section is opened, then pages them', async () => {
    const { container } = render(<Owner />);
    expect(screen.queryByText('Student 0')).not.toBeInTheDocument();
    const students = [...container.querySelectorAll('details')].find((d) => d.textContent.startsWith('Student accounts'));
    students.open = true;
    fireEvent(students, new Event('toggle'));
    expect(await screen.findByText('Student 0')).toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 8')).toBeInTheDocument();
    expect(screen.queryByText('Student 7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show more/i }));
    expect(await screen.findByText('Student 7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove|reset password/i })).not.toBeInTheDocument(); // students are view-only

    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'student3' } });
    await waitFor(() => expect(screen.queryByText('Student 0')).not.toBeInTheDocument());
    expect(screen.getByText('Student 3')).toBeInTheDocument();
  });

  it('creates a staff login and shows the password once', async () => {
    const { container } = render(<Owner />);
    const staffFold = [...container.querySelectorAll('details')].find((d) => d.textContent.startsWith('Staff accounts'));
    staffFold.open = true;
    fireEvent(staffFold, new Event('toggle'));
    expect(await screen.findByText('Meera K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /create a new staff login/i }));
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Cook' } });
    fireEvent.change(screen.getByPlaceholderText(/Staff email/), { target: { value: 'cook@ves.ac.in' } });
    fireEvent.click(screen.getByRole('button', { name: /^create staff login$/i }));
    expect(await screen.findByText('Abcd2345Xy')).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  it('has no way to turn a student into staff', () => {
    render(<Owner />);
    expect(screen.queryByText(/make staff/i)).not.toBeInTheDocument();
  });
});
