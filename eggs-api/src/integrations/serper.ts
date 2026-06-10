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
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    /** Per-request timeout (ms). Bounds the leg so a hung request can't stall
     *  the discovery pool slot — this is how we stay responsive, not an
     *  artificial per-item cap upstream. */
    private timeoutMs = 8000
  ) {}

  async shopping(query: string, locationLabel?: string): Promise<ShoppingCandidate[]> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, ...(locationLabel ? { location: locationLabel } : {}), num: 10 }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<unreadable>')
        console.warn('[serper] shopping non-ok', res.status, errBody.slice(0, 200))
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
    } finally {
      clearTimeout(t)
    }
  }

  /** Loose banner match: normalized-banner token containment either way.
   * Prevents short-slug false positives (e.g., 'al' matching 'albertsons')
   * with 4-char minimum on the contained string, except for exact matches.
   */
  static filterByMerchant(candidates: ShoppingCandidate[], banner: string): ShoppingCandidate[] {
    const want = normalizeBanner(banner).replace(/[^a-z0-9]/g, '')
    return candidates.filter(c => {
      const got = normalizeBanner(c.merchant).replace(/[^a-z0-9]/g, '')
      if (got === want) return true
      return (want.length >= 4 && got.includes(want)) || (got.length >= 4 && want.includes(got))
    })
  }
}

function parsePrice(text?: string): number | null {
  if (!text) return null
  const cleaned = text.replace(/,/g, '')
  // Prefer the first $-prefixed amount — picks the headline price out of
  // strings like "$4.98 each($0.50 / oz)". Downstream page verification is
  // the safety net for wrong prices; this only selects the candidate.
  const dollar = cleaned.match(/\$\s*(\d+(?:\.\d{1,2})?)/)
  if (dollar) return Number(dollar[1])
  const bare = cleaned.match(/(\d+(?:\.\d{1,2})?)/)
  return bare ? Number(bare[1]) : null
}
