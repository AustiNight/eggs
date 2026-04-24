export interface VerifyResult {
  verified: boolean
  reason?: string
}

export interface VerifyOptions {
  timeoutMs?: number
  minNameCoverage?: number
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'or'])

function extractTextFromHtml(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return noScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase()
}

function priceAppears(text: string, price: number): boolean {
  const dollars = Math.floor(price)
  const cents = Math.round((price - dollars) * 100).toString().padStart(2, '0')
  const formats = [
    `$${dollars}.${cents}`,
    `${dollars}.${cents}`,
    `${dollars},${cents}`,
    `$ ${dollars}.${cents}`,
  ]
  return formats.some(f => text.includes(f))
}

function nameCoverage(text: string, name: string): number {
  const tokens = name.toLowerCase().split(/[\s\-_/]+/).filter(t => t.length > 2 && !STOP_WORDS.has(t))
  if (tokens.length === 0) return 1
  const hits = tokens.filter(t => text.includes(t)).length
  return hits / tokens.length
}

export async function verifyProductContent(
  url: string,
  productName: string,
  price: number,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 6000
  const minCoverage = opts.minNameCoverage ?? 0.6

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; EggsBot/1.0)' },
    })
    if (!res.ok) return { verified: false, reason: `http_${res.status}` }
    const html = await res.text()
    const text = extractTextFromHtml(html)

    const coverage = nameCoverage(text, productName)
    if (coverage < minCoverage) return { verified: false, reason: `name_coverage_${coverage.toFixed(2)}` }

    if (!priceAppears(text, price)) return { verified: false, reason: 'price_not_found' }

    return { verified: true }
  } catch (err: any) {
    if (err?.name === 'AbortError') return { verified: false, reason: 'timeout' }
    return { verified: false, reason: `fetch_error_${err?.message ?? 'unknown'}` }
  } finally {
    clearTimeout(t)
  }
}
