// Server-side URL validation. HEAD-request a candidate URL with a short timeout;
// accept only 2xx. Used to confirm AI-asserted product URLs actually resolve
// before surfacing them to the user as a "Proof" link.

const VALIDATOR_UA = 'Mozilla/5.0 (compatible; EGGS-Validator/1.0)'

/**
 * Returns true iff a HEAD/GET request to the URL resolves with a 2xx response
 * within the timeout. Falls back to a Range GET if HEAD is rejected (some sites
 * return 405 for HEAD).
 */
export async function validateUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  if (!url || typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  const attempt = async (method: 'HEAD' | 'GET'): Promise<Response | null> => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = { 'User-Agent': VALIDATOR_UA }
      if (method === 'GET') headers['Range'] = 'bytes=0-0'
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers
      })
      return res
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  }

  const head = await attempt('HEAD')
  if (head?.ok) return true
  // 405/403 on HEAD is common; retry with a tiny GET range
  if (head && (head.status === 405 || head.status === 403)) {
    const get = await attempt('GET')
    return !!get?.ok
  }
  return false
}

/**
 * Validate many URLs in parallel, returning the subset that resolved 2xx.
 * Preserves insertion order is not guaranteed — callers should use the Set.
 */
export async function validateUrls(urls: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(urls))
  const results = await Promise.all(
    unique.map(async u => ({ url: u, ok: await validateUrl(u) }))
  )
  return new Set(results.filter(r => r.ok).map(r => r.url))
}
