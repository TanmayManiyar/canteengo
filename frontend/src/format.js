// crypto.randomUUID() only exists on HTTPS pages and localhost; the S3 site is plain HTTP, so fall back.
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const rupees = (n) => '₹' + (Number.isInteger(n) ? n : Number(n).toFixed(2));

const BY_NAME = [
  [/samosa|kachori/i, '🥟'],
  [/chai|tea|coffee/i, '☕'],
  [/sandwich|toast/i, '🥪'],
  [/pizza/i, '🍕'],
  [/burger|vada ?pav|pav/i, '🍔'],
  [/dosa|uttapam|pancake/i, '🥞'],
  [/idli|upma|poha/i, '🍚'],
  [/noodle|maggi|pasta|chowmein/i, '🍜'],
  [/rice|biryani|thali|meal/i, '🍛'],
  [/fries|chips/i, '🍟'],
  [/roll|wrap|paratha/i, '🌯'],
  [/juice|shake|lassi|cold|soda|drink/i, '🥤'],
  [/cake|brownie|pastry/i, '🍰'],
  [/ice ?cream|kulfi/i, '🍨'],
  [/egg/i, '🍳'],
];
const BY_CATEGORY = [
  [/bever|drink/i, '🥤'],
  [/snack/i, '🍿'],
  [/meal|lunch|main/i, '🍛'],
  [/dessert|sweet/i, '🍰'],
];

// No photos are stored for items, so each card gets an emoji tile chosen from its name or category.
export function emojiFor(item) {
  for (const [re, e] of BY_NAME) if (re.test(item.name)) return e;
  for (const [re, e] of BY_CATEGORY) if (re.test(item.category || '')) return e;
  return '🍽️';
}

export const timeAgo = (ms) =>
  new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
