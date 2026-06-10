// Serper.dev Google Shopping client (WS1 discovery leg).
// Index prices are candidates ONLY — never store-trusted (spec: honesty rules).
import { normalizeBanner } from './store-urls.js'

export interface ShoppingCandidate {
  title: string
  /** Parsed numeric price, null when Serper returned none. */
  price: number | null
  merchant: string
  /** Google Shopping redirect — NOT a merchant product page. Kept for diagnostics only. */
  link?: string
}

export class SerperClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  async shopping(query: string, locationLabel?: string): Promise<ShoppingCandidate[]> {
    try {
      const res = await this.fetchImpl('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, ...(locationLabel ? { location: locationLabel } : {}), num: 10 }),
      })
      if (!res.ok) {
        console.warn('[serper] shopping non-ok', res.status)
        return []
      }
      const data = (await res.json()) as { shopping?: Array<{ title?: string; price?: string; source?: string; link?: string }> }
      return (data.shopping ?? []).map(r => ({
        title: r.title ?? '',
        price: parsePrice(r.price),
        merchant: r.source ?? '',
        link: r.link,
      }))
    } catch (err) {
      console.warn('[serper] shopping threw', err instanceof Error ? err.message : err)
      return []
    }
  }

  /** Loose banner match: normalized-banner token containment either way. */
  static filterByMerchant(candidates: ShoppingCandidate[], banner: string): ShoppingCandidate[] {
    const want = normalizeBanner(banner).replace(/[^a-z0-9]/g, '')
    return candidates.filter(c => {
      const got = normalizeBanner(c.merchant).replace(/[^a-z0-9]/g, '')
      return got.length > 0 && (got.includes(want) || want.includes(got))
    })
  }
}

function parsePrice(text?: string): number | null {
  if (!text) return null
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  return m ? Number(m[1]) : null
}
