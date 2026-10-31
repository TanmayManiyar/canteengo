import { useMemo, useState } from 'react';
import { get } from '../api';
import { useData } from '../useData';
import { useCart } from '../cart';
import { emojiFor, rupees } from '../format';
import Stepper from '../components/Stepper';

// Menu and offers are fetched together; the last copy is shown instantly while a fresh one loads.
const fetchMenu = async () => {
  const [menu, offers] = await Promise.all([get('/menu'), get('/offers')]);
  return { categories: menu.categories, offers: offers.offers };
};

function ItemCard({ item }) {
  const { state, dispatch } = useCart();
  const qty = state[item.id]?.quantity || 0;
  return (
    <article className={'item' + (item.available ? '' : ' off')}>
      <div className="item-info">
        <h3>{item.name}</h3>
        {item.avgRating && <span className="rating">★ {item.avgRating}</span>}
        <div className="price">{rupees(item.price)}</div>
        {!item.available && <div className="muted">Currently unavailable</div>}
      </div>
      <div className="item-media">
        <div className="tile" aria-hidden="true">{emojiFor(item)}</div>
        {item.available && (
          <div className="item-action">
            <Stepper
              qty={qty}
              label={item.name}
              onAdd={() => dispatch({ type: 'add', item })}
              onSub={() => dispatch({ type: 'setQty', id: item.id, quantity: qty - 1 })}
            />
          </div>
        )}
      </div>
    </article>
  );
}

export default function Menu() {
  const { data, error, loading } = useData('menu', fetchMenu);
  const [q, setQ] = useState('');

  const categories = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!data) return [];
    return data.categories
      .map((c) => ({
        ...c,
        items: needle ? c.items.filter((i) => i.name.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle)) : c.items,
      }))
      .filter((c) => c.items.length);
  }, [data, q]);

  const jump = (name) => document.getElementById('cat-' + name)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div>
      <div className="search-wrap">
        <input className="search" placeholder="Search for dishes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu" />
      </div>

      {error && data && <p className="banner">Showing saved menu, it may be outdated. ({error})</p>}
      {error && !data && <p className="error">{error}</p>}

      {data?.offers?.length > 0 && (
        <div className="offers" aria-label="Offers">
          {data.offers.map((o) => (
            <div key={o.id} className="offer-card">
              <span className="offer-tag">OFFER</span>
              <strong>{o.title}</strong>
              {o.description && <span>{o.description}</span>}
            </div>
          ))}
        </div>
      )}

      {categories.length > 1 && (
        <div className="chips" role="navigation" aria-label="Categories">
          {categories.map((c) => (
            <button key={c.category} className="chip" onClick={() => jump(c.category)}>{c.category}</button>
          ))}
        </div>
      )}

      {loading && !data && (
        <div aria-busy="true">
          {[1, 2, 3].map((n) => <div key={n} className="skeleton" />)}
        </div>
      )}

      {categories.map((c) => (
        <section key={c.category} id={'cat-' + c.category} className="category">
          <h2>{c.category} <span className="muted">({c.items.length})</span></h2>
          {c.items.map((i) => <ItemCard key={i.id} item={i} />)}
        </section>
      ))}

      {data && !categories.length && <p className="center muted">Nothing matches "{q}".</p>}
    </div>
  );
}
