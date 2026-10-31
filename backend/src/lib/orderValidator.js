'use strict';
// CanteenGo order-validation (from Exp 7, 20 unit tests, 100% coverage). Used for REQ-9 / REQ-11.
// The menu is passed in as plain data; this module has no I/O.

const MAX_QTY_PER_ITEM = 10;
const MAX_ITEMS_PER_ORDER = 20;

function isPositiveInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function isValidPrice(p) {
  return typeof p === 'number' && Number.isFinite(p) && p > 0;
}

// Work in paise (integers) to avoid floating-point errors such as 0.1 * 3.
function toPaise(rupees) {
  return Math.round(rupees * 100);
}

/**
 * @param {Array<{itemId:string, quantity:number, price:number}>} cart
 * @param {Array<{id:string, name:string, price:number, available:boolean}>} menu
 * @returns {{valid:boolean, errors:string[], total:number}}  total in rupees
 */
function validateOrder(cart, menu) {
  const errors = [];

  if (!Array.isArray(cart) || cart.length === 0) {
    return { valid: false, errors: ['Cart is empty'], total: 0 };
  }
  if (cart.length > MAX_ITEMS_PER_ORDER) {
    return { valid: false, errors: [`Cart has more than ${MAX_ITEMS_PER_ORDER} line items`], total: 0 };
  }

  const menuById = new Map((menu || []).map((m) => [m.id, m]));
  const seen = new Set();
  let totalPaise = 0;

  for (const line of cart) {
    const id = line && line.itemId;
    if (seen.has(id)) {
      errors.push(`Duplicate item in cart: ${id}`);
      continue;
    }
    seen.add(id);

    const menuItem = menuById.get(id);
    if (!menuItem) {
      errors.push(`Unknown menu item: ${id}`);
      continue;
    }
    if (!menuItem.available) {
      errors.push(`Item unavailable: ${id}`);
      continue;
    }
    if (!isPositiveInt(line.quantity)) {
      errors.push(`Invalid quantity for ${id}`);
      continue;
    }
    if (line.quantity > MAX_QTY_PER_ITEM) {
      errors.push(`Quantity for ${id} exceeds limit of ${MAX_QTY_PER_ITEM}`);
      continue;
    }
    if (!isValidPrice(line.price)) {
      errors.push(`Invalid price for ${id}`);
      continue;
    }
    if (toPaise(line.price) !== toPaise(menuItem.price)) {
      errors.push(`Price mismatch for ${id}`);
      continue;
    }
    totalPaise += toPaise(menuItem.price) * line.quantity;
  }

  if (errors.length > 0) return { valid: false, errors, total: 0 };
  return { valid: true, errors: [], total: totalPaise / 100 };
}

module.exports = { validateOrder, MAX_QTY_PER_ITEM, MAX_ITEMS_PER_ORDER };
