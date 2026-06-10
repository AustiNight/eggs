// Tavily search client (WS1 resolution leg) — finds merchant product-page URLs
// for a Serper shopping candidate, scoped to the banner's domain.
export interface TavilyResult {
  url: string
  title: string
  content: string
}

export interface TavilySearchOptions {
  includeDomains?: string[]
  maxResults?: number
}

export class TavilyClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  async search(query: string, opts: TavilySearchOptions = {}): Promise<TavilyResult[]> {
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
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<unreadable>')
        console.warn('[tavily] search non-ok', res.status, errBody.slice(0, 200))
        return []
      }
      const data = (await res.json()) as { results?: Array<{ url?: string; title?: string; content?: string }> }
      return (data.results ?? [])
        .filter(r => typeof r.url === 'string')
        .map(r => ({ url: r.url as string, title: r.title ?? '', content: r.content ?? '' }))
    } catch (err) {
      console.warn('[tavily] search threw', err instanceof Error ? err.message : err)
      return []
    }
  }
}
