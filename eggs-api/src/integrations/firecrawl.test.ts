import { describe, it, expect, vi } from 'vitest'
import { FirecrawlClient } from './firecrawl'

const SCRAPE_RESPONSE = {
  success: true,
  data: {
    markdown: '# H-E-B Organics Chicken\n\n$4.98 each($0.50 / oz)\n\nYou\'re shopping Victoria H‑E‑B plus!',
    metadata: { statusCode: 200, sourceURL: 'https://www.heb.com/product-detail/x/1', proxyUsed: 'basic' },
  },
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as typeof fetch
}

describe('FirecrawlClient.scrape', () => {
  it('returns markdown + statusCode on success', async () => {
    const client = new FirecrawlClient('fc-x', mockFetch(SCRAPE_RESPONSE))
    const out = await client.scrape('https://www.heb.com/product-detail/x/1')
    expect(out?.markdown).toContain('$4.98')
    expect(out?.statusCode).toBe(200)
    expect(out?.sourceUrl).toBe('https://www.heb.com/product-detail/x/1')
  })

  it('passes headers, actions, and timeout through; defaults timeout 9000', async () => {
    const f = mockFetch(SCRAPE_RESPONSE)
    await new FirecrawlClient('fc-x', f).scrape('https://x.com/p', {
      headers: { Cookie: 'store=42' },
      actions: [{ type: 'wait', milliseconds: 500 }],
      timeoutMs: 9000,
    })
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
    const body = JSON.parse(init.body as string)
    expect(body.headers).toEqual({ Cookie: 'store=42' })
    expect(body.actions).toEqual([{ type: 'wait', milliseconds: 500 }])
    expect(body.timeout).toBe(9000)
    expect(body.proxy).toBe('auto')
    expect(body.formats).toEqual(['markdown'])
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer fc-x')

    const f2 = mockFetch(SCRAPE_RESPONSE)
    await new FirecrawlClient('fc-x', f2).scrape('https://x.com/p')
    const body2 = JSON.parse((f2 as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body2.timeout).toBe(9000)
    expect(body2).not.toHaveProperty('headers')
    expect(body2).not.toHaveProperty('actions')
  })

  it('returns null on API error, non-2xx page status, and thrown fetch', async () => {
    expect(await new FirecrawlClient('k', mockFetch({ success: false }, true)).scrape('https://x.com')).toBeNull()
    const errPage = { success: true, data: { markdown: 'Page Not Found', metadata: { statusCode: 404, sourceURL: 'https://x.com' } } }
    expect(await new FirecrawlClient('k', mockFetch(errPage)).scrape('https://x.com')).toBeNull()
    expect(await new FirecrawlClient('k', mockFetch({ success: true, data: { markdown: 'text' } })).scrape('https://x.com')).toBeNull()
    expect(await new FirecrawlClient('k', mockFetch({}, false, 429)).scrape('https://x.com')).toBeNull()
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new FirecrawlClient('k', boom).scrape('https://x.com')).toBeNull()
  })

  it('respects timeoutMs override', async () => {
    const f = mockFetch(SCRAPE_RESPONSE)
    await new FirecrawlClient('fc-x', f).scrape('https://x.com/p', { timeoutMs: 15000 })
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.timeout).toBe(15000)
  })
})
