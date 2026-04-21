// ─── IdpClient tests ──────────────────────────────────────────────────────────
//
// All tests use a mocked `fetchImpl` — no real network calls are made.
// Mock responses match the Instacart IDP Recipe Page API JSON shape.

import { describe, it, expect, vi } from 'vitest'
import { IdpClient } from './instacart-idp.js'
import type { ShoppableItemSpec } from '../types/spec.js'

// ─── Test fixtures ────────────────────────────────────────────────────────────

/** Minimal valid ShoppableItemSpec for test use. */
function makeSpec(overrides?: Partial<ShoppableItemSpec>): ShoppableItemSpec {
  return {
    id: 'spec-1',
    sourceText: '2 lbs chicken breast',
    displayName: 'chicken breast',
    categoryPath: ['meat', 'poultry', 'chicken'],
    brand: null,
    brandLocked: false,
    quantity: 2,
    unit: 'lb',
    resolutionTrace: [],
    confidence: 'high',
    ...overrides,
  }
}

/** A mock fetch that returns a 200 with a products_link_url. */
function mockFetch200(url = 'https://www.instacart.com/store/checkout/start?token=abc123') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ products_link_url: url }),
  })
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('IdpClient.createShoppingListPage', () => {

  // ── Test 1: Happy path ─────────────────────────────────────────────────────
  it('happy path — returns productsLinkUrl from response', async () => {
    const expectedUrl = 'https://www.instacart.com/store/checkout/start?token=abc123'
    const client = new IdpClient({
      apiKey: 'test-key',
      fetchImpl: mockFetch200(expectedUrl),
    })

    const result = await client.createShoppingListPage(
      [makeSpec()],
      'E.G.G.S. Shopping List — 2026-04-21',
      'https://eggs.app/plan/plan-123'
    )

    expect(result.productsLinkUrl).toBe(expectedUrl)
  })

  // ── Test 2: Request shape ─────────────────────────────────────────────────
  it('request shape — POST body contains required fields', async () => {
    const fetchMock = mockFetch200()
    const client = new IdpClient({ apiKey: 'test-key', fetchImpl: fetchMock })

    const spec = makeSpec({ displayName: 'whole milk', quantity: 1, unit: 'gal' })
    const title = 'Test Shopping List'
    const linkback = 'https://eggs.app/plan/xyz'

    await client.createShoppingListPage([spec], title, linkback)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [_url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)

    // Required top-level fields
    expect(body.title).toBe(title)
    expect(body.link_type).toBe('recipe')
    expect(Array.isArray(body.ingredients)).toBe(true)
    expect(body.ingredients).toHaveLength(1)
    expect(body.ingredients[0].name).toBe('whole milk')

    // landing_page_configuration
    expect(body.landing_page_configuration.partner_linkback_url).toBe(linkback)
    expect(body.landing_page_configuration.enable_pantry_items).toBe(false)

    // Structural constants
    expect(body.image_url).toBeNull()
    expect(body.instructions).toEqual([])
  })

  // ── Test 3: Auth header ───────────────────────────────────────────────────
  it('auth header — sends Authorization: Bearer {apiKey}', async () => {
    const fetchMock = mockFetch200()
    const client = new IdpClient({ apiKey: 'super-secret-key', fetchImpl: fetchMock })

    await client.createShoppingListPage(
      [makeSpec()],
      'Test',
      null
    )

    const [_url, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer super-secret-key')
  })

  // ── Test 4: Non-2xx throws ────────────────────────────────────────────────
  it('non-2xx response — throws a descriptive error', async () => {
    const failFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'server error' }),
    })
    const client = new IdpClient({ apiKey: 'test-key', fetchImpl: failFetch })

    await expect(
      client.createShoppingListPage([makeSpec()], 'Test', null)
    ).rejects.toThrow('500')
  })

  // ── Test 5: Malformed response (missing products_link_url) ────────────────
  it('malformed response — throws when products_link_url is absent', async () => {
    const badFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ some_other_field: 'value' }),
    })
    const client = new IdpClient({ apiKey: 'test-key', fetchImpl: badFetch })

    await expect(
      client.createShoppingListPage([makeSpec()], 'Test', null)
    ).rejects.toThrow('products_link_url')
  })

  // ── Test 6: Empty specs array — still makes the call ─────────────────────
  it('empty specs — still POSTs with empty ingredients array', async () => {
    const fetchMock = mockFetch200()
    const client = new IdpClient({ apiKey: 'test-key', fetchImpl: fetchMock })

    const result = await client.createShoppingListPage([], 'Empty List', null)

    expect(result.productsLinkUrl).toBeTruthy()
    const [_url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.ingredients).toEqual([])
  })

  // ── Test 7: Uses custom baseUrl ───────────────────────────────────────────
  it('custom baseUrl — POSTs to the overridden base URL', async () => {
    const fetchMock = mockFetch200()
    const client = new IdpClient({
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      baseUrl: 'https://sandbox.instacart.com',
    })

    await client.createShoppingListPage([makeSpec()], 'Test', null)

    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).toContain('https://sandbox.instacart.com')
    expect(calledUrl).toContain('/idp/v1/products/recipe')
  })

  // ── Test 8: Multiple specs — all mapped to ingredients ───────────────────
  it('multiple specs — all specs are mapped to ingredients', async () => {
    const fetchMock = mockFetch200()
    const client = new IdpClient({ apiKey: 'test-key', fetchImpl: fetchMock })

    const specs = [
      makeSpec({ id: 's1', displayName: 'chicken breast' }),
      makeSpec({ id: 's2', displayName: 'olive oil', quantity: 0.5, unit: 'cup' }),
      makeSpec({ id: 's3', displayName: 'garlic', quantity: 3, unit: 'clove' }),
    ]

    await client.createShoppingListPage(specs, 'Dinner List', 'https://eggs.app/plan/abc')

    const [_url, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.ingredients).toHaveLength(3)
    const names = body.ingredients.map((i: { name: string }) => i.name)
    expect(names).toContain('chicken breast')
    expect(names).toContain('olive oil')
    expect(names).toContain('garlic')
  })
})
