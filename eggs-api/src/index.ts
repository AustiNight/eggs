import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { HonoEnv } from './types/index.js'

import users from './routes/users.js'
import events from './routes/events.js'
import scale from './routes/scale.js'
import clarify from './routes/clarify.js'
import plan from './routes/plan.js'
import products from './routes/products.js'

const app = new Hono<HonoEnv>()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow Cloudflare Pages, localhost dev, and any *.pages.dev subdomain
      if (!origin) return '*'
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.endsWith('.pages.dev') ||
        origin.endsWith('.eggs.app') ||
        origin === 'https://priceofeggs.online' ||
        origin === 'https://www.priceofeggs.online'
      ) {
        return origin
      }
      return null
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-AI-Key', 'X-AI-Provider', 'X-Service-Key', 'X-On-Behalf-Of'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  })
)

// Health check — no auth
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }))

// API routes
app.route('/api/users', users)
app.route('/api/events', events)
app.route('/api/scale-recipes', scale)
app.route('/api/clarify', clarify)
app.route('/api/price-plan', plan)
app.route('/api/products', products)

// Global error handler — catch unhandled exceptions, malformed JSON, etc.
app.onError((err, c) => {
  console.error('Unhandled error:', err.message)
  if (err.message.includes('Unexpected') || err.message.includes('JSON')) {
    return c.json({ error: 'Invalid request body' }, 400)
  }
  return c.json({ error: 'Internal server error' }, 500)
})

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
