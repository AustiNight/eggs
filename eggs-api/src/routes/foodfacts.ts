import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { OpenFoodFactsClient } from '../integrations/openfoodfacts.js'

const foodfacts = new Hono<HonoEnv>()
const off = new OpenFoodFactsClient()

// GET /api/food/barcode/:code
// Look up a product by EAN/UPC barcode. Fast — 100 req/min limit at OFF.
foodfacts.get('/barcode/:code', requireAuth, async (c) => {
  const code = c.req.param('code')
  if (!code || !/^\d{8,14}$/.test(code)) {
    return c.json({ error: 'Invalid barcode — must be 8–14 digits' }, 400)
  }

  const product = await off.getByBarcode(code)
  if (!product) {
    return c.json({ error: 'Product not found' }, 404)
  }

  return c.json({ product })
})

// GET /api/food/search?q=chicken+breast&page=1&pageSize=5
// Search products by name. Rate-limited — OFF enforces 10 req/min for search.
// Do NOT call this on every keystroke.
foodfacts.get('/search', requireAuth, rateLimit, async (c) => {
  const q = c.req.query('q')
  if (!q?.trim()) {
    return c.json({ error: 'q is required' }, 400)
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1)
  const pageSize = Math.min(10, Math.max(1, parseInt(c.req.query('pageSize') ?? '5', 10) || 5))

  const result = await off.searchByName(q.trim(), page, pageSize)
  return c.json(result)
})

export default foodfacts
