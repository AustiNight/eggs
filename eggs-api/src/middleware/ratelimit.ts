import type { Context, Next } from 'hono'
import type { HonoEnv } from '../types/index.js'

const WINDOW_SECONDS = 60
const MAX_REQUESTS = 30

export const rateLimit = async (
  c: Context<HonoEnv>,
  next: Next
) => {
  const userId = c.get('userId') as string
  const key = `rl:${userId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`

  const current = await c.env.RATE_LIMIT_KV.get(key)
  const count = current ? parseInt(current) : 0

  if (count >= MAX_REQUESTS) {
    return c.json({ error: 'rate_limit_exceeded', retryAfter: WINDOW_SECONDS }, 429)
  }

  await c.env.RATE_LIMIT_KV.put(key, String(count + 1), {
    expirationTtl: WINDOW_SECONDS * 2
  })

  await next()
}
