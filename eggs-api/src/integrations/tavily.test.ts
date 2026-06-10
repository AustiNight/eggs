import { describe, it, expect, vi } from 'vitest'
import { TavilyClient } from './tavily.js'

const SEARCH_RESPONSE = {
  results: [
    { url: 'https://www.heb.com/product-detail/x/1748922', title: 'H-E-B Organics Chunk Chicken', content: '10 oz. $4.98 each', score: 0.76 },
    { url: 'https://www.heb.com/category/chicken/490110', title: 'Chicken - Shop H-E-B', content: 'category page', score: 0.7 },
  ],
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as typeof fetch
}

describe('TavilyClient.search', () => {
  it('returns url/title/content results', async () => {
    const client = new TavilyClient('tvly-x', mockFetch(SEARCH_RESPONSE))
    const out = await client.search('H-E-B Organics chicken', { includeDomains: ['heb.com'], maxResults: 5 })
    expect(out).toHaveLength(2)
    expect(out[0].url).toContain('product-detail')
    expect(out[0].score).toBe(0.76)
  })

  it('sends bearer auth, include_domains and max_results', async () => {
    const f = mockFetch(SEARCH_RESPONSE)
    await new TavilyClient('tvly-x', f).search('q', { includeDomains: ['heb.com'], maxResults: 5 })
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-x')
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', include_domains: ['heb.com'], max_results: 5 })
  })

  it('omits include_domains when not provided and defaults max_results to 5', async () => {
    const f = mockFetch(SEARCH_RESPONSE)
    await new TavilyClient('tvly-x', f).search('q', {})
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('include_domains')
    expect(body.max_results).toBe(5)
  })

  it('returns [] on error / non-2xx', async () => {
    expect(await new TavilyClient('k', mockFetch({}, false, 429)).search('x', {})).toEqual([])
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new TavilyClient('k', boom).search('x', {})).toEqual([])
  })

  it('filters out results missing a url', async () => {
    const client = new TavilyClient('k', mockFetch({ results: [{ title: 'no url' }, { url: 'https://a.com', title: 'ok' }] }))
    const out = await client.search('x', {})
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://a.com')
  })
})
