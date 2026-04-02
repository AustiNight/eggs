import { verifyToken } from '@clerk/backend'
import type { Context, Next } from 'hono'
import type { HonoEnv } from '../types/index.js'

export const requireAuth = async (c: Context<HonoEnv>, next: Next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verifyToken(token, { secretKey: c.env.CLERK_SECRET_KEY })
    c.set('userId', payload.sub)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}

// Tapestry service-to-service or regular Clerk auth
export const requireAuthOrServiceKey = async (
  c: Context<HonoEnv>,
  next: Next
) => {
  const serviceKey = c.req.header('X-Service-Key')
  if (serviceKey && serviceKey === c.env.TAPESTRY_SERVICE_KEY) {
    const onBehalfOf = c.req.header('X-On-Behalf-Of')
    if (!onBehalfOf) return c.json({ error: 'X-On-Behalf-Of required' }, 400)
    c.set('userId', onBehalfOf)
    await next()
    return
  }
  await requireAuth(c, next)
}
