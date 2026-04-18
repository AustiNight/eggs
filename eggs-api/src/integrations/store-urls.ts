// Deterministic search-landing URL templates per US grocery banner.
// Guarantees a valid "Shop" link for every StoreItem even when live retrieval fails.

const TEMPLATES: Record<string, (q: string) => string> = {
  'target':            q => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`,
  'walmart':           q => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  'kroger':            q => `https://www.kroger.com/search?query=${encodeURIComponent(q)}`,
  'costco':            q => `https://www.costco.com/s?keyword=${encodeURIComponent(q)}`,
  "sam's club":        q => `https://www.samsclub.com/s/${encodeURIComponent(q)}`,
  'sams club':         q => `https://www.samsclub.com/s/${encodeURIComponent(q)}`,
  'whole foods':       q => `https://www.wholefoodsmarket.com/search?text=${encodeURIComponent(q)}`,
  'whole foods market':q => `https://www.wholefoodsmarket.com/search?text=${encodeURIComponent(q)}`,
  'aldi':              q => `https://new.aldi.us/results?q=${encodeURIComponent(q)}`,
  "trader joe's":      q => `https://www.traderjoes.com/home/search?q=${encodeURIComponent(q)}&section=products`,
  'trader joes':       q => `https://www.traderjoes.com/home/search?q=${encodeURIComponent(q)}&section=products`,
  'sprouts':           q => `https://shop.sprouts.com/search?search_term=${encodeURIComponent(q)}`,
  'sprouts farmers market': q => `https://shop.sprouts.com/search?search_term=${encodeURIComponent(q)}`,
  'heb':               q => `https://www.heb.com/search?q=${encodeURIComponent(q)}`,
  'h-e-b':             q => `https://www.heb.com/search?q=${encodeURIComponent(q)}`,
  'publix':            q => `https://www.publix.com/search?search_term=${encodeURIComponent(q)}`,
  'albertsons':        q => `https://www.albertsons.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'safeway':           q => `https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'tom thumb':         q => `https://www.tomthumb.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'jewel-osco':        q => `https://www.jewelosco.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'jewel osco':        q => `https://www.jewelosco.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'vons':              q => `https://www.vons.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'shaws':             q => `https://www.shaws.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  "shaw's":            q => `https://www.shaws.com/shop/search-results.html?q=${encodeURIComponent(q)}`,
  'fiesta mart':       q => `https://www.fiestamart.com/search?q=${encodeURIComponent(q)}`,
  'meijer':            q => `https://www.meijer.com/shop/en/search?text=${encodeURIComponent(q)}`,
  'wegmans':           q => `https://shop.wegmans.com/search?search_term=${encodeURIComponent(q)}`,
  'giant eagle':       q => `https://www.gianteagle.com/search?search=${encodeURIComponent(q)}`,
  'food lion':         q => `https://shop.foodlion.com/search?search_term=${encodeURIComponent(q)}`,
  'harris teeter':     q => `https://www.harristeeter.com/search?query=${encodeURIComponent(q)}`,
  'stop & shop':       q => `https://stopandshop.com/search?q=${encodeURIComponent(q)}`,
  'stop and shop':     q => `https://stopandshop.com/search?q=${encodeURIComponent(q)}`,
  'instacart':         q => `https://www.instacart.com/store/s?k=${encodeURIComponent(q)}`,
}

export function normalizeBanner(storeBanner: string): string {
  return storeBanner
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '')
    .trim()
}

/**
 * Build a guaranteed-valid Shop URL for a given store banner and query.
 * Returns a Google-scoped fallback for unknown banners so the link is never null.
 */
export function getShopUrl(storeBanner: string, query: string): string {
  const key = normalizeBanner(storeBanner)
  const template = TEMPLATES[key]
  if (template) return template(query)
  // Unknown banner — Google search scoped to the banner name, always resolves
  return `https://www.google.com/search?q=${encodeURIComponent(`${storeBanner} ${query}`)}`
}

/** Exposed for testing — list of registered banner keys. */
export function knownBanners(): string[] {
  return Object.keys(TEMPLATES)
}
