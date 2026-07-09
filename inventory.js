/* ============ LIVE PHONE INVENTORY (Supabase) ============
   Fetches the `phones` table from Supabase and reshapes it into the same
   { name, img, tag, columns, rows } shape main.js's sliders expect, so
   nothing else has to change. See SETUP-GUIDE.md for the one-time Supabase
   project setup (create project, run supabase-schema.sql, get these two
   values below).

   Until you fill in the real URL/key, this quietly does nothing and the
   site keeps using its built-in fallback prices — nothing breaks. */

const SUPABASE_URL = 'https://eyfkcfulzhzhtbyjdsbn.supabase.co'; // e.g. https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5ZmtjZnVsemh6aHRieWpkc2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTUxNjUsImV4cCI6MjA5OTA5MTE2NX0.bIKq4B4E2IVQ8ZfIB_OOWFaW7qQWRnmlQ4_uM_AGgkE';

window.fetchPhoneInventory = async function fetchPhoneInventory() {
  if (
    !SUPABASE_URL ||
    SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL' ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY'
  ) {
    return null; // not configured yet — caller falls back to hardcoded prices
  }

  const endpoint = `${SUPABASE_URL}/rest/v1/phones?select=*&in_stock=eq.true&order=sort_order.asc`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  const dbRows = await res.json();

  // Group flat rows (one per model+storage) back into per-model cards.
  const byModel = new Map();
  for (const row of dbRows) {
    const key = `${row.category}::${row.model}`;
    if (!byModel.has(key)) {
      byModel.set(key, {
        name: row.model,
        img: row.image,
        tag: row.tag || undefined,
        category: row.category,
        columns: row.category === 'new_lineup' ? ['Storage', 'New', 'Used'] : ['Storage', 'Price'],
        rows: [],
      });
    }
    const card = byModel.get(key);
    if (row.category === 'new_lineup') {
      card.rows.push([row.storage, row.new_price, row.used_price]);
    } else {
      card.rows.push([row.storage, row.used_price]);
    }
  }

  const all = [...byModel.values()];
  return {
    newPhones: all.filter((p) => p.category === 'new_lineup'),
    preownedPhones: all.filter((p) => p.category === 'preowned_lineup'),
  };
};
