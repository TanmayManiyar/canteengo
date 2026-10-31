import { MAX_QTY } from '../cart';

// "ADD" turns into a "− 1 +" stepper once the item is in the cart.
export default function Stepper({ qty, onAdd, onSub, disabled, label }) {
  if (!qty) {
    return (
      <button className="add-btn" disabled={disabled} onClick={onAdd} aria-label={`Add ${label || 'item'}`}>
        ADD
      </button>
    );
  }
  return (
    <div className="stepper" role="group" aria-label={`${label || 'Item'} quantity`}>
      <button onClick={onSub} aria-label={`Remove one ${label || 'item'}`}>−</button>
      <span aria-live="polite">{qty}</span>
      <button onClick={onAdd} disabled={qty >= MAX_QTY} aria-label={`Add one more ${label || 'item'}`}>+</button>
    </div>
  );
}
