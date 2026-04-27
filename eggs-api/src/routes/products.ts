import { Hono } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/ratelimit.js'
import { KrogerClient } from '../integrations/kroger.js'

const products = new Hono<HonoEnv>()

// GET /api/products/search?q=chicken+breast&locationId=12345
products.get('/search', requireAuth, rateLimit, async (c) => {
  const q = c.req.query('q')
  const locationId = c.req.query('locationId')

  if (!q || !locationId) {
    return c.json({ error: 'q and locationId are required' }, 400)
  }

  const kroger = new KrogerClient(
    c.env.KROGER_CLIENT_ID,
    c.env.KROGER_CLIENT_SECRET,
    undefined,
    c.env.URL_CACHE
  )
  const results = await kroger.searchProducts(q, locationId)
  return c.json({ products: results })
})

export default products
