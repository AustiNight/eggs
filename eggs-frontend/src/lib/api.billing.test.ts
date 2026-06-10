import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startCheckout, openBillingPortal } from './api'

// ─── window.location stub (happy-dom) ────────────────────────────────────────
const originalLocation = window.location

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { href: '', origin: 'https://app.test', search: '' },
    writable: true,
    configurable: true
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true
  })
  vi.restoreAllMocks()
})

function mockFetch(url: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ url })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('startCheckout', () => {
  it('POSTs to /api/billing/checkout with appUrl + bearer token, then redirects', async () => {
    const fetchMock = mockFetch('https://checkout.stripe.com/s/test')

    await startCheckout('tok-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(calledUrl).toContain('/api/billing/checkout')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ appUrl: 'https://app.test' })
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(window.location.href).toBe('https://checkout.stripe.com/s/test')
  })
})

describe('openBillingPortal', () => {
  it('POSTs to /api/billing/portal with appUrl + bearer token, then redirects', async () => {
    const fetchMock = mockFetch('https://billing.stripe.com/p/test')

    await openBillingPortal('tok-456')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(calledUrl).toContain('/api/billing/portal')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ appUrl: 'https://app.test' })
    expect(init.headers.Authorization).toBe('Bearer tok-456')
    expect(window.location.href).toBe('https://billing.stripe.com/p/test')
  })
})
