import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Stepper from './Stepper';

describe('Stepper', () => {
  it('shows ADD when the item is not in the cart', () => {
    const onAdd = vi.fn();
    render(<Stepper qty={0} label="Samosa" onAdd={onAdd} onSub={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add samosa/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows − 1 + once the item is in the cart', () => {
    const onAdd = vi.fn();
    const onSub = vi.fn();
    render(<Stepper qty={1} label="Samosa" onAdd={onAdd} onSub={onSub} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add one more/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove one/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onSub).toHaveBeenCalledTimes(1);
  });

  it('stops the plus button at the 10-per-item limit', () => {
    render(<Stepper qty={10} label="Samosa" onAdd={() => {}} onSub={() => {}} />);
    expect(screen.getByRole('button', { name: /add one more/i })).toBeDisabled();
  });
});
