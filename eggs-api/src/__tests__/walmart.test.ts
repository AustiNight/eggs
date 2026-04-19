import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WalmartClient, pemToArrayBuffer, arrayBufferToBase64 } from '../integrations/walmart.js'

// A throwaway RSA-2048 private key generated solely for these tests.
// DO NOT reuse — it's not secret and it's not the user's Walmart key.
const TEST_PKCS8_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCw4OMqZ1Gn2eCI
wPtQa/sJ/sgxtwDjhLn42VaAqBqG7jmhqb3BPlX5b5uk/RmnQmJi4YmQx/d9QH7G
zV5GhqfXNzwKQ9hTHxFQZMnkeV4VBO70cyRxFrMyn8S0KH/1Pd4qJJHN8cBJc6z2
UBjMXOl6ejIJQRL3j8sPjm+4yJjP5jQo1x9SxMnFJ0SJhMpKFS5IWJaD0Gxtwh2X
xRmLuZCEbTpNxPO6+Yw/v9qESdeUGLQH3pD3Nz4UjJLVS2iNKlJ1BXyYq3xKIyD5
whWrntjUQnjzJJPkk0Wkz5CJ5sIbDk7LQ0cUVYT8cXL3j7hbcSP/gCqPq5KnFMrN
tJMVBxgzAgMBAAECggEAE2xYdgoqmA+HMzf4SXM7gXZTjZtfOp8T4ddPvpN5JfAw
TESTKEY_NOT_A_REAL_VALUE_PLACEHOLDER_BASE64_CONTENT_LINE_ONE_HERE
TESTKEY_NOT_A_REAL_VALUE_PLACEHOLDER_BASE64_CONTENT_LINE_TWO_HERE
-----END PRIVATE KEY-----`

describe('walmart.pemToArrayBuffer', () => {
  it('strips PEM armor and decodes base64 body', () => {
    const pem = `-----BEGIN PRIVATE KEY-----
aGVsbG8=
-----END PRIVATE KEY-----`
    const buf = pemToArrayBuffer(pem)
    expect(new TextDecoder().decode(buf)).toBe('hello')
  })

  it('tolerates whitespace and newline variations', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\n  aGVsbG8=  \n-----END PRIVATE KEY-----\n'
    const buf = pemToArrayBuffer(pem)
    expect(new TextDecoder().decode(buf)).toBe('hello')
  })
})

describe('walmart.arrayBufferToBase64', () => {
  it('round-trips arbitrary bytes', () => {
    const input = new Uint8Array([0, 1, 2, 255, 127, 128])
    const b64 = arrayBufferToBase64(input.buffer)
    expect(b64).toBe(btoa(String.fromCharCode(...input)))
  })
})

describe('WalmartClient.signHeaders', () => {
  let importKeySpy: ReturnType<typeof vi.spyOn>
  let signSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    const fakeKey = {} as CryptoKey
    importKeySpy = vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue(fakeKey)
    signSpy = vi.spyOn(crypto.subtle, 'sign').mockImplementation(
      async (_algo, _key, data) => {
        // Return a deterministic fake signature derived from the canonical bytes
        const bytes = new Uint8Array(data as ArrayBuffer)
        const out = new Uint8Array(32)
        for (let i = 0; i < bytes.length; i++) out[i % 32] ^= bytes[i]
        return out.buffer
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('produces the four WM_* auth headers', async () => {
    const client = new WalmartClient('consumer-uuid', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'pub-id')
    const headers = await client.signHeaders(1700000000000)
    expect(headers['WM_CONSUMER.ID']).toBe('consumer-uuid')
    expect(headers['WM_CONSUMER.INTIMESTAMP']).toBe('1700000000000')
    expect(headers['WM_SEC.KEY_VERSION']).toBe('1')
    expect(headers['WM_SEC.AUTH_SIGNATURE']).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('signs canonical string with values only (no header names), alphabetical order', async () => {
    const client = new WalmartClient('abc-123', '2', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'pub')
    await client.signHeaders(1700000000000)
    expect(signSpy).toHaveBeenCalledOnce()
    const signedData = signSpy.mock.calls[0][2] as Uint8Array
    const canonical = new TextDecoder().decode(signedData)
    // Per Walmart Java sample: only values are emitted, in alphabetical header-name order,
    // each terminated by '\n'. Order: WM_CONSUMER.ID < WM_CONSUMER.INTIMESTAMP < WM_SEC.KEY_VERSION.
    expect(canonical).toBe('abc-123\n1700000000000\n2\n')
  })

  it('caches the imported CryptoKey across calls', async () => {
    const client = new WalmartClient('c', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'p')
    await client.signHeaders(1)
    await client.signHeaders(2)
    await client.signHeaders(3)
    expect(importKeySpy).toHaveBeenCalledOnce()
    expect(signSpy).toHaveBeenCalledTimes(3)
  })

  it('produces deterministic signatures for identical inputs', async () => {
    const client = new WalmartClient('c', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'p')
    const a = await client.signHeaders(1700000000000)
    const b = await client.signHeaders(1700000000000)
    expect(a['WM_SEC.AUTH_SIGNATURE']).toBe(b['WM_SEC.AUTH_SIGNATURE'])
  })
})

describe('WalmartClient.getPriceForIngredient', () => {
  beforeEach(() => {
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey)
    vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array(32).buffer)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns mapped product for first good hit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [
        { itemId: 123, name: 'Bananas 3lb', brandName: 'Great Value',
          msrp: 2.48, salePrice: 1.98, productTrackingUrl: 'https://goto.walmart.com/c/track/abc', size: '3 lb' }
      ]
    }), { status: 200 }))

    const client = new WalmartClient('c', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'pub')
    const result = await client.getPriceForIngredient('bananas', '75201')
    expect(result).not.toBeNull()
    expect(result!.sku).toBe('123')
    expect(result!.regularPrice).toBe(2.48)
    expect(result!.promoPrice).toBe(1.98)
    expect(result!.productUrl).toBe('https://goto.walmart.com/c/track/abc')
  })

  it('returns null when search fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))
    const client = new WalmartClient('c', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'p')
    expect(await client.getPriceForIngredient('basil')).toBeNull()
  })

  it('skips items missing a usable URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [
        { itemId: 1, name: 'X', msrp: 5 /* no productUrl */ },
        { itemId: 2, name: 'Y', msrp: 6, productUrl: 'https://walmart.com/ip/y' }
      ]
    }), { status: 200 }))
    const client = new WalmartClient('c', '1', '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----', 'p')
    const result = await client.getPriceForIngredient('z')
    expect(result!.sku).toBe('2')
    expect(result!.productUrl).toBe('https://walmart.com/ip/y')
  })
})
