// Firecrawl v2 scrape client (WS1 verification-fetch fallback).
// Used when direct Worker fetch hits a bot wall, or a binding recipe needs
// cookies/actions. Smoke-tested 2026-06-09: H-E-B product page on basic proxy.
export type FirecrawlAction =
  | { type: 'wait'; milliseconds: number }
  | { type: 'click'; selector: string }
  | { type: 'write'; text: string }
  | { type: 'press'; key: string }
  | { type: 'executeJavascript'; script: string }

export interface ScrapeOptions {
  headers?: Record<string, string>
  actions?: FirecrawlAction[]
  timeoutMs?: number
}

export interface ScrapeResult {
  markdown: string
  statusCode: number
  sourceUrl: string
}

export class FirecrawlClient {
  constructor(
    private apiKey: string,
    /** Arrow wrapper avoids "Illegal invocation" on Cloudflare Workers. */
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  /** Returns null on any failure — caller treats null as "couldn't fetch". */
  async scrape(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult | null> {
    try {
      const res = await this.fetchImpl('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          proxy: 'auto',
          timeout: opts.timeoutMs ?? 9000,
          ...(opts.headers ? { headers: opts.headers } : {}),
          ...(opts.actions?.length ? { actions: opts.actions } : {}),
        }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<unreadable>')
        console.warn('[firecrawl] scrape non-ok', res.status, errBody.slice(0, 200))
        return null
      }
      const data = (await res.json()) as {
        success?: boolean
        data?: { markdown?: string; metadata?: { statusCode?: number; sourceURL?: string } }
      }
      if (!data.success || !data.data?.markdown) return null
      const statusCode = data.data.metadata?.statusCode ?? 0
      if (statusCode < 200 || statusCode >= 300) return null
      return {
        markdown: data.data.markdown,
        statusCode,
        sourceUrl: data.data.metadata?.sourceURL ?? url,
      }
    } catch (err) {
      console.warn('[firecrawl] scrape threw', err instanceof Error ? err.message : err)
      return null
    }
  }
}
