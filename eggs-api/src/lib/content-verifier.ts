import type { StoreIdentity } from '../types/index.js'
import { assertStoreBinding } from '../integrations/store-binding.js'

export interface VerifyResult {
  verified: boolean
  /** true only when expectedStore was provided AND the binding assertion passed */
  storeBound: boolean
  reason?: string
}

export interface VerifyOptions {
  timeoutMs?: number
  minNameCoverage?: number
}

export interface VerifyTextOptions {
  minNameCoverage?: number
  expectedStore?: StoreIdentity
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'or'])

function extractText(content: string): string {
  const noScripts = content.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return noScripts
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links → label text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
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

/** Pure verification against pre-fetched page content (HTML or markdown). */
export function verifyContentText(
  rawContent: string,
  productName: string,
  price: number,
  opts: VerifyTextOptions = {},
): VerifyResult {
  const minCoverage = opts.minNameCoverage ?? 0.6
  const normalizedText = extractText(rawContent)

  const coverage = nameCoverage(normalizedText, productName)
  if (coverage < minCoverage) return { verified: false, storeBound: false, reason: `name_coverage_${coverage.toFixed(2)}` }
  if (!priceAppears(normalizedText, price)) return { verified: false, storeBound: false, reason: 'price_not_found' }

  // assertStoreBinding gets the RAW content — it does its own normalization and
  // needs the raw markup for store-id attribute matching.
  const storeBound = opts.expectedStore ? assertStoreBinding(rawContent, opts.expectedStore) : false
  return { verified: true, storeBound }
}

// NOTE: the network wrapper never passes expectedStore — store-bound verification requires the orchestrator's bound fetch (lib/price-discovery, Task 8/9). storeBound from this wrapper is always false by design.
export async function verifyProductContent(
  url: string,
  productName: string,
  price: number,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 6000

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; EggsBot/1.0)' },
    })
    if (!res.ok) return { verified: false, storeBound: false, reason: `http_${res.status}` }
    const html = await res.text()
    return verifyContentText(html, productName, price, { minNameCoverage: opts.minNameCoverage })
  } catch (err: any) {
    if (err?.name === 'AbortError') return { verified: false, storeBound: false, reason: 'timeout' }
    return { verified: false, storeBound: false, reason: `fetch_error_${err?.message ?? 'unknown'}` }
  } finally {
    clearTimeout(t)
  }
}
