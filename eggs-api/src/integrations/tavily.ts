// Tavily search client (WS1 resolution leg) — finds merchant product-page URLs
// for a Serper shopping candidate, scoped to the banner's domain.
export interface TavilyResult {
  url: string
  title: string
  content: string
  score: number
}

export interface TavilySearchOptions {
  includeDomains?: string[]
  maxResults?: number
}

export class TavilyClient {
  constructor(
    private apiKey: string,
    /** Arrow wrapper avoids "Illegal invocation" on Cloudflare Workers. */
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    /** Per-request timeout (ms). Bounds the leg so a hung request can't stall
     *  the discovery pool slot. */
    private timeoutMs = 8000
  ) {}

  async search(query: string, opts: TavilySearchOptions = {}): Promise<TavilyResult[]> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: opts.maxResults ?? 5,
          ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<unreadable>')
        console.warn('[tavily] search non-ok', res.status, errBody.slice(0, 200))
        return []
      }
      const data = (await res.json()) as { results?: Array<{ url?: string; title?: string; content?: string; score?: number }> }
      return (data.results ?? [])
        .filter(r => typeof r.url === 'string')
        .map(r => ({ url: r.url as string, title: r.title ?? '', content: r.content ?? '', score: r.score ?? 0 }))
    } catch (err) {
      console.warn('[tavily] search threw', err instanceof Error ? err.message : err)
      return []
    } finally {
      clearTimeout(t)
    }
  }
}
