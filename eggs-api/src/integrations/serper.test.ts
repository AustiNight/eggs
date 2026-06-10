import { describe, it, expect, vi } from 'vitest'
import { SerperClient, type ShoppingCandidate } from './serper.js'

const SHOPPING_RESPONSE = {
  shopping: [
    { title: 'H-E-B Organics Fresh Boneless Skinless Chicken Breast lb', price: '$6.74', source: 'H-E-B', link: 'https://www.google.com/search?ibp=oshop&q=x' },
    { title: 'Tyson Chicken Breast', price: '$5.99', source: 'Target', link: 'https://www.google.com/...' },
    { title: 'No-price item', source: 'H-E-B' },
  ],
}

function mockFetch(json: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as typeof fetch
}

describe('SerperClient.shopping', () => {
  it('returns candidates with parsed numeric prices', async () => {
    const fetchImpl = mockFetch(SHOPPING_RESPONSE)
    const client = new SerperClient('key', fetchImpl)
    const out = await client.shopping('organic chicken breast H-E-B', 'Dallas, Texas, United States')
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ title: expect.stringContaining('Chicken Breast'), price: 6.74, merchant: 'H-E-B' })
    expect(out[2].price).toBeNull()
  })

  it('sends query, location and API key header', async () => {
    const fetchImpl = mockFetch(SHOPPING_RESPONSE)
    const client = new SerperClient('key-123', fetchImpl)
    await client.shopping('eggs', 'Dallas, Texas, United States')
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://google.serper.dev/shopping')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('key-123')
    expect(JSON.parse(init.body as string)).toMatchObject({ q: 'eggs', location: 'Dallas, Texas, United States' })
  })

  it('returns [] on non-2xx and on thrown fetch', async () => {
    expect(await new SerperClient('k', mockFetch({}, false, 429)).shopping('x')).toEqual([])
    const boom = vi.fn().mockRejectedValue(new Error('net')) as unknown as typeof fetch
    expect(await new SerperClient('k', boom).shopping('x')).toEqual([])
  })

  it('logs response body on non-ok status', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mockBody = JSON.stringify({ error: 'rate limited' })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => mockBody,
    }) as unknown as typeof fetch
    const client = new SerperClient('k', fetchImpl)
    await client.shopping('x')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[serper] shopping non-ok'),
      429,
      expect.stringContaining('error')
    )
    warnSpy.mockRestore()
  })

  it('omits location key when locationLabel is undefined', async () => {
    const fetchImpl = mockFetch(SHOPPING_RESPONSE)
    const client = new SerperClient('key', fetchImpl)
    await client.shopping('eggs')
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body).not.toHaveProperty('location')
    expect(body).toMatchObject({ q: 'eggs' })
  })

  it('filterByMerchant matches banner loosely (case/punctuation-insensitive)', async () => {
    const candidates: ShoppingCandidate[] = [
      { title: 'Item 1', price: 6.74, merchant: 'H-E-B' },
      { title: 'Item 2', price: 5.99, merchant: 'Target' },
    ]
    const heb = SerperClient.filterByMerchant(candidates, 'H-E-B')
    expect(heb).toHaveLength(1)
    expect(heb[0].merchant).toBe('H-E-B')
    expect(SerperClient.filterByMerchant(candidates, 'Target')).toHaveLength(1)
  })

  it('filterByMerchant prevents short-slug false positives', () => {
    const candidates: ShoppingCandidate[] = [
      { title: 'Item 1', price: 6.74, merchant: 'Sprouts Farmers Market' },
      { title: 'Item 2', price: 5.99, merchant: 'Albertsons' },
    ]
    // 'Sprouts' (7 chars) matches 'Sprouts Farmers Market' by containment
    const sprouts = SerperClient.filterByMerchant(candidates, 'Sprouts')
    expect(sprouts).toHaveLength(1)
    expect(sprouts[0].merchant).toBe('Sprouts Farmers Market')

    // 'al' (2 chars) should NOT match 'Albertsons' (false positive guard)
    const al = SerperClient.filterByMerchant(candidates, 'al')
    expect(al).toHaveLength(0)

    // Exact match 'heb' should still work (3 chars exact)
    const candidates2: ShoppingCandidate[] = [{ title: 'Item', price: 1.0, merchant: 'H-E-B' }]
    const heb = SerperClient.filterByMerchant(candidates2, 'heb')
    expect(heb).toHaveLength(1)
  })

  describe('parsePrice', () => {
    it('prefers $-prefixed prices', () => {
      // From the fix spec: extracts headline price from compound strings
      const result1 = new SerperClient('k', mockFetch({ shopping: [{ price: '$4.98 each($0.50 / oz)' }] })).shopping('x')
      expect(result1).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ price: 4.98 })])
      )
    })

    it('falls back to bare number when no $ prefix', () => {
      const result1 = new SerperClient('k', mockFetch({ shopping: [{ price: '6.74' }] })).shopping('x')
      expect(result1).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ price: 6.74 })])
      )
    })

    it('handles comma-separated numbers', () => {
      const result1 = new SerperClient('k', mockFetch({ shopping: [{ price: '$1,234.56' }] })).shopping('x')
      expect(result1).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ price: 1234.56 })])
      )
    })
  })
})
