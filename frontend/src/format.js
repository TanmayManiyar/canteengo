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
