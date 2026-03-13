// netlify/functions/utils/slugify.js
// Converts a business name to a URL-safe slug.

/**
 * slugify('Honest To Crust!')  => 'honest-to-crust'
 * slugify('  My  Bakery 2 ') => 'my-bakery-2'
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric (keep spaces/hyphens)
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/-{2,}/g, '-')         // collapse multiple hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

/**
 * Given a desired slug and a Supabase admin client, returns a unique slug.
 * Appends -2, -3, … until no collision is found in the tenants table.
 */
async function uniqueTenantSlug(desired, supabase) {
  const base = slugify(desired);
  let candidate = base;
  let attempt   = 1;

  while (true) {
    const { data, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data) return candidate;   // no collision

    attempt  += 1;
    candidate = `${base}-${attempt}`;

    if (attempt > 50) {
      throw new Error(`Could not find a unique slug for base "${base}" after 50 attempts`);
    }
  }
}

module.exports = { slugify, uniqueTenantSlug };
