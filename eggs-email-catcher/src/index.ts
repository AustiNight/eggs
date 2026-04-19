// eggs-email-catcher
// Cloudflare Email Worker that:
//   1. Receives inbound mail at eggs-test-*@aulson.pro (via Cloudflare Email Routing)
//   2. Parses MIME + extracts common OTP formats (6-digit codes, magic links)
//   3. Stores each message in KV with 10-minute TTL
//   4. Exposes an authenticated HTTP API so Claude / CI can poll for the latest OTP
//
// Security:
//   - Rejects any inbound address that doesn't match ALLOWED_EMAIL_PATTERN
//   - All HTTP endpoints require SERVICE_KEY header
//   - OTP values are never logged in plaintext
//   - Short TTL (10 min) minimizes on-disk OTP lifetime

import { Hono } from 'hono'
import PostalMime from 'postal-mime'

interface Env {
  EMAIL_INBOX: KVNamespace
  ALLOWED_EMAIL_PATTERN: string
  SERVICE_KEY: string
}

interface StoredEmail {
  to: string
  from: string
  subject: string
  receivedAt: string
  /** The extracted OTP if the subject/body matched a known pattern. */
  otp?: string
  /** Magic-link URLs found in the body, if any. */
  magicLinks?: string[]
  /** First 4KB of the plaintext body — enough to diagnose, bounded for storage. */
  bodySnippet?: string
}

// ─── Email handler (Cloudflare Email Workers contract) ───────────────────────
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const allowed = new RegExp(env.ALLOWED_EMAIL_PATTERN)
    if (!allowed.test(message.to)) {
      // Bounce anything off-pattern so we don't silently swallow misrouted mail.
      message.setReject(`Address ${message.to} not accepted`)
      return
    }

    let parsed
    try {
      parsed = await PostalMime.parse(message.raw)
    } catch (err) {
      console.error('[email] MIME parse failed:', err instanceof Error ? err.message : err)
      return
    }

    const subject = (parsed.subject ?? '').slice(0, 500)
    const from = parsed.from?.address ?? 'unknown'
    const body = (parsed.text ?? stripHtml(parsed.html ?? '')).slice(0, 8000)

    const otp = extractOtp(subject, body)
    const magicLinks = extractMagicLinks(body)

    const stored: StoredEmail = {
      to: message.to,
      from,
      subject,
      receivedAt: new Date().toISOString(),
      otp,
      magicLinks: magicLinks.length ? magicLinks : undefined,
      bodySnippet: body.slice(0, 4000)
    }

    const ts = Date.now()
    const historyKey = `email:${message.to}:${ts}`
    const latestKey = `latest:${message.to}`

    // Redact OTP from logs even at debug level.
    console.log(`[email] received to=${message.to} from=${from} subject="${subject.slice(0, 120)}" otp_present=${!!otp}`)

    ctx.waitUntil(Promise.all([
      env.EMAIL_INBOX.put(historyKey, JSON.stringify(stored), { expirationTtl: 600 }),
      env.EMAIL_INBOX.put(latestKey, JSON.stringify(stored), { expirationTtl: 600 })
    ]))
  },

  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx)
}

// ─── HTTP API (authenticated) ────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  // Health check is unauthenticated; everything else requires the service key.
  if (c.req.path === '/health') return next()
  const key = c.req.header('X-Service-Key')
  if (!key || key !== c.env.SERVICE_KEY) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

app.get('/health', (c) =>
  c.json({ status: 'ok', ts: new Date().toISOString() })
)

app.get('/latest', async (c) => {
  const email = c.req.query('email')
  if (!email) return c.json({ error: 'missing email query param' }, 400)
  const raw = await c.env.EMAIL_INBOX.get(`latest:${email}`)
  if (!raw) return c.json({ error: 'no email found for this address in the last 10 min' }, 404)
  return c.json(JSON.parse(raw) as StoredEmail)
})

app.get('/history', async (c) => {
  const email = c.req.query('email')
  if (!email) return c.json({ error: 'missing email query param' }, 400)
  const list = await c.env.EMAIL_INBOX.list({ prefix: `email:${email}:`, limit: 20 })
  const keys = list.keys.map(k => k.name).sort().reverse().slice(0, 10)
  const vals = await Promise.all(keys.map(k => c.env.EMAIL_INBOX.get(k)))
  const items = vals.filter((v): v is string => !!v).map(v => JSON.parse(v) as StoredEmail)
  return c.json({ count: items.length, items })
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities — fallback when no plaintext part exists. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the most likely OTP from subject + body.
 * Handles Clerk's 6-digit format, Stripe-style 6-digit codes, and common 4-8 digit codes.
 * Prefers subject-line digits (Clerk puts the code in the subject) over body digits.
 */
function extractOtp(subject: string, body: string): string | undefined {
  // 1. Clerk format: "Your verification code is 123456"
  const clerkSubject = subject.match(/\b(\d{6})\b/)
  if (clerkSubject) return clerkSubject[1]

  // 2. Subject patterns like "123456 is your code"
  const subjectHead = subject.match(/^(\d{4,8})\b/)
  if (subjectHead) return subjectHead[1]

  // 3. Body patterns like "Enter this code: 123456" or "Your code is 123456"
  const bodyPhrase = body.match(/(?:verification code|confirm(?:ation)? code|code|pin|otp)[^\d]{0,30}(\d{4,8})/i)
  if (bodyPhrase) return bodyPhrase[1]

  // 4. Fallback: first 6-digit group in the body, but only if it's surrounded by whitespace/newline
  const bodyGeneric = body.match(/(?:^|\s)(\d{6})(?:\s|$)/)
  if (bodyGeneric) return bodyGeneric[1]

  return undefined
}

/** Extract magic-link URLs (sign-in links, password-reset links). */
function extractMagicLinks(body: string): string[] {
  const urls = body.match(/https?:\/\/[^\s<>"')]+/g) ?? []
  // Filter for URLs that look like auth callbacks
  const authy = urls.filter(u =>
    /sign-in|signin|verify|verification|magic|token|callback|reset|confirm/i.test(u)
  )
  return Array.from(new Set(authy)).slice(0, 5)
}
