import { describe, it, expect, vi } from 'vitest'
import { SerperClient } from './serper.js'

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

  it('filterByMerchant matches banner loosely (case/punctuation-insensitive)', async () => {
    const client = new SerperClient('k', mockFetch(SHOPPING_RESPONSE))
    const all = await client.shopping('x')
    const heb = SerperClient.filterByMerchant(all, 'H-E-B')
    expect(heb).toHaveLength(2)
    expect(SerperClient.filterByMerchant(all, 'heb')).toHaveLength(2)
    expect(SerperClient.filterByMerchant(all, 'Target')).toHaveLength(1)
  })
})
