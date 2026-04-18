import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateUrl, validateUrls } from '../lib/url-validator.js'

describe('url-validator.validateUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when HEAD returns 2xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )
    const ok = await validateUrl('https://example.com/product/123')
    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const callArgs = fetchSpy.mock.calls[0][1]
    expect(callArgs?.method).toBe('HEAD')
  })

  it('returns false when HEAD returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 404 })
    )
    const ok = await validateUrl('https://example.com/does-not-exist')
    expect(ok).toBe(false)
  })

  it('falls back to GET-range when HEAD returns 405', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response('partial', { status: 206 }))
    const ok = await validateUrl('https://example.com/only-get')
    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][1]?.method).toBe('GET')
  })

  it('falls back to GET-range when HEAD returns 403', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const ok = await validateUrl('https://example.com/blocks-head')
    expect(ok).toBe(true)
  })

  it('returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const ok = await validateUrl('https://bad.example/')
    expect(ok).toBe(false)
  })

  it('returns false on timeout (aborted fetch)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('aborted')), 10))
    )
    const ok = await validateUrl('https://slow.example/', 5)
    expect(ok).toBe(false)
  })

  it('rejects malformed URLs without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await validateUrl('not a url')).toBe(false)
    expect(await validateUrl('')).toBe(false)
    expect(await validateUrl('javascript:alert(1)')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('includes a transparent User-Agent header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )
    await validateUrl('https://example.com/')
    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>
    expect(headers['User-Agent']).toContain('EGGS-Validator')
  })
})

describe('url-validator.validateUrls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns only the URLs that resolved 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = typeof url === 'string' ? url : (url as Request).url
      if (u.includes('good')) return new Response(null, { status: 200 })
      return new Response(null, { status: 404 })
    })
    const verified = await validateUrls([
      'https://a.example/good',
      'https://b.example/bad',
      'https://c.example/good'
    ])
    expect(verified.has('https://a.example/good')).toBe(true)
    expect(verified.has('https://c.example/good')).toBe(true)
    expect(verified.has('https://b.example/bad')).toBe(false)
    expect(verified.size).toBe(2)
  })

  it('deduplicates input URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    )
    await validateUrls([
      'https://a.example/x',
      'https://a.example/x',
      'https://a.example/x'
    ])
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
