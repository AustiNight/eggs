#!/usr/bin/env tsx
/**
 * Task 7 (WS1) — Store-binding spike. LIVE: burns Firecrawl/Serper/Tavily credits.
 * Budget ≤60 Firecrawl credits (≈ ≤21 scrapes). Approved by Jonathan.
 *
 * For each priority US grocery banner, determine whether a product-page fetch
 * can be BOUND to a concrete store, and capture REAL page content so we can:
 *   (a) write a findings doc,
 *   (b) promote validated binding recipes into the registry, and
 *   (c) back fixture tests for assertStoreBinding against real captured content.
 *
 * Flow per banner:
 *   1. SerperClient.shopping(staple + banner, "Dallas, Texas, United States")
 *   2. Tavily search scoped to the banner domain → a real product-page URL
 *   3. Firecrawl scrape UNBOUND (basic proxy) → record store-indicator text + snippet
 *   4. ≤2 binding levers (cookie / actions: ZIP 75201 → select store → wait)
 *
 * Run: npx tsx scripts/spike-store-binding.ts
 * Output: structured per-banner summary + capture JSON dumped to
 *   docs/superpowers/research/2026-06-store-binding-captures.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SerperClient } from '../src/integrations/serper.js'
import { TavilyClient } from '../src/integrations/tavily.js'
import { FirecrawlClient, type FirecrawlAction } from '../src/integrations/firecrawl.js'
import { bannerDomain } from '../src/integrations/store-binding.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_DIR = resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Credit accounting (Firecrawl is the budgeted resource).
// ---------------------------------------------------------------------------
let firecrawlScrapes = 0
let firecrawlActionScrapes = 0
const FIRECRAWL_BUDGET = 60
function creditsUsed(): number {
  // Firecrawl: ~1 credit / basic scrape, actions add ~1 each (conservative).
  return firecrawlScrapes + firecrawlActionScrapes * 2
}

// ---------------------------------------------------------------------------
// .dev.vars parsing.
// ---------------------------------------------------------------------------
function parseDevVars(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`.dev.vars not found at ${path}`)
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

const DALLAS = 'Dallas, Texas, United States'
const ZIP = '75201'

// Store-indicator phrasings seen across US grocery banners. Capture the line
// + surrounding context so we can paste it verbatim into a fixture.
const INDICATOR_PATTERNS: RegExp[] = [
  /you'?re shopping[^!\n.]{0,80}/i,
  /(?:my|your|current|selected)\s+store[:\s][^!\n.]{0,80}/i,
  /shopping (?:at|in)[:\s][^!\n.]{0,80}/i,
  /shop(?:ping)? (?:from )?(?:your )?(?:local )?store[:\s][^!\n.]{0,80}/i,
  /store #?\d{2,6}/i,
  /pickup (?:at|from)[:\s][^!\n.]{0,80}/i,
  /(?:set|choose|select) (?:a |your )?store/i,
]

interface IndicatorHit {
  pattern: string
  match: string
  /** ~500 char window around the indicator for fixture use. */
  snippet: string
}

function findIndicators(markdown: string): IndicatorHit[] {
  const hits: IndicatorHit[] = []
  const seen = new Set<string>()
  for (const re of INDICATOR_PATTERNS) {
    const m = re.exec(markdown)
    if (!m) continue
    const idx = m.index
    const start = Math.max(0, idx - 200)
    const end = Math.min(markdown.length, idx + 300)
    const key = m[0].toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      pattern: re.source.slice(0, 50),
      match: m[0].trim(),
      snippet: markdown.slice(start, end).replace(/\n{3,}/g, '\n\n'),
    })
  }
  return hits
}

// ---------------------------------------------------------------------------
// Per-banner config: staple item + lever guesses (cookie names, actions).
// ---------------------------------------------------------------------------
interface BannerSpike {
  banner: string
  staple: string
  /** Cookie-lever guesses: name → value template (storeId placeholder). */
  cookieLevers?: { name: string; value: string; note: string }[]
  /** Actions-lever: ZIP entry → store select → wait. */
  actionsLever?: { note: string; actions: FirecrawlAction[] }
}

const BANNERS: BannerSpike[] = [
  {
    banner: 'H-E-B',
    staple: 'organic whole milk',
    cookieLevers: [
      { name: 'CURR_SESSION_STORE', value: '38', note: 'H-E-B store-id cookie guess (38 = a Dallas-area store)' },
    ],
    actionsLever: {
      note: 'open store picker, type ZIP, wait for store list',
      actions: [
        { type: 'wait', milliseconds: 3000 },
        { type: 'click', selector: '[data-qe-id="changeStoreButton"], button[aria-label*="store" i]' },
        { type: 'wait', milliseconds: 1500 },
        { type: 'write', text: ZIP },
        { type: 'wait', milliseconds: 2500 },
        { type: 'scrape' },
      ],
    },
  },
  {
    banner: 'Central Market',
    staple: 'boneless skinless chicken breast',
    actionsLever: {
      note: 'store picker + ZIP',
      actions: [
        { type: 'wait', milliseconds: 3000 },
        { type: 'write', text: ZIP },
        { type: 'wait', milliseconds: 2500 },
        { type: 'scrape' },
      ],
    },
  },
  {
    banner: 'Tom Thumb',
    staple: 'organic whole milk',
    cookieLevers: [
      { name: 'storeId', value: '1234', note: 'Albertsons-family storeId cookie guess' },
      { name: 'ABS_StoreId', value: '1234', note: 'Albertsons store-id cookie guess' },
    ],
  },
  {
    banner: 'Target',
    staple: 'organic whole milk',
    cookieLevers: [
      { name: 'fiatsCart', value: '', note: 'placeholder' },
      { name: 'GuestLocation', value: '32.78,-96.80|75201|Dallas|TX|US', note: 'Target GuestLocation geo cookie (Dallas)' },
    ],
    actionsLever: {
      note: 'store selector + ZIP',
      actions: [
        { type: 'wait', milliseconds: 3000 },
        { type: 'write', text: ZIP },
        { type: 'wait', milliseconds: 2500 },
        { type: 'scrape' },
      ],
    },
  },
  {
    banner: 'Sprouts',
    staple: 'organic whole milk',
    actionsLever: {
      note: 'shop.sprouts ZIP entry',
      actions: [
        { type: 'wait', milliseconds: 3000 },
        { type: 'write', text: ZIP },
        { type: 'wait', milliseconds: 2500 },
        { type: 'scrape' },
      ],
    },
  },
  {
    banner: 'Aldi',
    staple: 'organic whole milk',
    actionsLever: {
      note: 'aldi.us delivery ZIP entry',
      actions: [
        { type: 'wait', milliseconds: 3000 },
        { type: 'write', text: ZIP },
        { type: 'wait', milliseconds: 2500 },
        { type: 'scrape' },
      ],
    },
  },
  {
    banner: "Trader Joe's",
    staple: 'organic whole milk',
    // TJ's has no e-commerce; expected no indicator / unbindable.
  },
]

interface BannerOutcome {
  banner: string
  domain: string | null
  staple: string
  candidateTitle?: string
  candidatePrice?: number | null
  productUrl?: string
  unboundScrapeOk: boolean
  unboundIndicators: IndicatorHit[]
  unboundSnippet?: string
  leverResults: { lever: string; ok: boolean; indicators: IndicatorHit[]; changed: boolean; note: string }[]
  verdict: string
  error?: string
}

async function runBanner(
  spec: BannerSpike,
  serper: SerperClient,
  tavily: TavilyClient,
  firecrawl: FirecrawlClient,
): Promise<BannerOutcome> {
  const domain = bannerDomain(spec.banner)
  const out: BannerOutcome = {
    banner: spec.banner,
    domain,
    staple: spec.staple,
    unboundScrapeOk: false,
    unboundIndicators: [],
    leverResults: [],
    verdict: 'pending',
  }
  if (!domain) {
    out.verdict = 'no domain in registry — skipped'
    return out
  }

  // --- Leg 1: Serper shopping candidate ---
  const candidates = await serper.shopping(`${spec.staple} ${spec.banner}`, DALLAS)
  const bannerCands = SerperClient.filterByMerchant(candidates, spec.banner)
  const pick = bannerCands[0] ?? candidates[0]
  if (pick) {
    out.candidateTitle = pick.title
    out.candidatePrice = pick.price
  }
  console.log(`  [${spec.banner}] serper: ${candidates.length} candidates, ${bannerCands.length} on-banner`)

  // --- Leg 2: Tavily resolve a real product-page URL on the banner domain ---
  const tavilyQuery = pick?.title ? `${pick.title} site:${domain}` : `${spec.staple} ${spec.banner}`
  const results = await tavily.search(tavilyQuery, { includeDomains: [domain], maxResults: 5 })
  // Prefer a URL that looks like a product detail page, not a category/search.
  const productUrl =
    results.find(r => /\/p\/|\/product|\/products\/|\/ip\/|\/-\/A-|\/dp\//i.test(r.url))?.url ??
    results[0]?.url
  out.productUrl = productUrl
  console.log(`  [${spec.banner}] tavily: ${results.length} results → ${productUrl ?? '(none)'}`)
  if (!productUrl) {
    out.verdict = 'no product URL resolved on banner domain — cannot probe'
    return out
  }

  // --- Leg 3: UNBOUND Firecrawl scrape ---
  if (creditsUsed() >= FIRECRAWL_BUDGET) {
    out.verdict = 'credit budget exhausted before unbound scrape'
    return out
  }
  firecrawlScrapes++
  const unbound = await firecrawl.scrape(productUrl, { timeoutMs: 30000 })
  if (!unbound) {
    out.verdict = 'unbound scrape failed (bot wall / non-2xx) — unbindable via this fetch path'
    return out
  }
  out.unboundScrapeOk = true
  out.unboundIndicators = findIndicators(unbound.markdown)
  out.unboundSnippet = unbound.markdown.slice(0, 1200)
  console.log(`  [${spec.banner}] unbound scrape ok (${unbound.markdown.length} chars), ${out.unboundIndicators.length} indicator hits`)

  if (out.unboundIndicators.length === 0) {
    out.verdict = 'no indicator — unbindable for now (caps at page_verified_unbound at best; no store proof)'
    return out
  }

  // --- Leg 4: binding levers (≤2) ---
  const baselineMatch = out.unboundIndicators[0]?.match ?? ''

  // Cookie lever(s)
  for (const c of spec.cookieLevers ?? []) {
    if (creditsUsed() >= FIRECRAWL_BUDGET) break
    firecrawlScrapes++
    const cookieHeader = `${c.name}=${c.value}`
    const res = await firecrawl.scrape(productUrl, { headers: { Cookie: cookieHeader }, timeoutMs: 30000 })
    const inds = res ? findIndicators(res.markdown) : []
    const changed = !!res && inds.some(i => i.match !== baselineMatch)
    out.leverResults.push({
      lever: `cookie:${c.name}`,
      ok: !!res,
      indicators: inds,
      changed,
      note: `${c.note} | header=${cookieHeader}`,
    })
    console.log(`  [${spec.banner}] cookie ${c.name}: ok=${!!res} changed=${changed}`)
    if (changed) break // one working lever is enough
  }

  // Actions lever (only if cookie didn't already crack it)
  const cookieCracked = out.leverResults.some(l => l.changed)
  if (!cookieCracked && spec.actionsLever && creditsUsed() < FIRECRAWL_BUDGET) {
    firecrawlActionScrapes++
    const res = await firecrawl.scrape(productUrl, {
      actions: spec.actionsLever.actions,
      timeoutMs: 60000,
    })
    const inds = res ? findIndicators(res.markdown) : []
    const changed = !!res && inds.some(i => i.match !== baselineMatch)
    out.leverResults.push({
      lever: 'actions:zip-store-select',
      ok: !!res,
      indicators: inds,
      changed,
      note: spec.actionsLever.note,
    })
    console.log(`  [${spec.banner}] actions lever: ok=${!!res} changed=${changed}`)
  }

  const anyLeverChanged = out.leverResults.some(l => l.changed)
  if (anyLeverChanged) {
    const lever = out.leverResults.find(l => l.changed)!
    out.verdict = `recipe candidate (${lever.lever}): indicator changed to "${lever.indicators[0]?.match}" — VALIDATE assertStoreBinding before promoting`
  } else {
    out.verdict = `indicator renders ("${baselineMatch}"), binding not cracked by tried levers — caps at page_verified_unbound`
  }
  return out
}

async function main() {
  const vars = parseDevVars(resolve(API_DIR, '.dev.vars'))
  const serperKey = vars.SERPER_API_KEY
  const tavilyKey = vars.TAVILY_API_KEY
  const firecrawlKey = vars.FIRECRAWL_API_KEY
  if (!serperKey || !tavilyKey || !firecrawlKey) {
    throw new Error('Missing one of SERPER_API_KEY / TAVILY_API_KEY / FIRECRAWL_API_KEY in .dev.vars')
  }

  const serper = new SerperClient(serperKey, undefined, 15000)
  const tavily = new TavilyClient(tavilyKey, undefined, 15000)
  const firecrawl = new FirecrawlClient(firecrawlKey)

  console.log('=== Store-binding spike (LIVE) — budget', FIRECRAWL_BUDGET, 'Firecrawl credits ===\n')

  const outcomes: BannerOutcome[] = []
  for (const spec of BANNERS) {
    console.log(`\n--- ${spec.banner} (credits so far: ${creditsUsed()}) ---`)
    try {
      outcomes.push(await runBanner(spec, serper, tavily, firecrawl))
    } catch (err) {
      outcomes.push({
        banner: spec.banner,
        domain: bannerDomain(spec.banner),
        staple: spec.staple,
        unboundScrapeOk: false,
        unboundIndicators: [],
        leverResults: [],
        verdict: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
      console.warn(`  [${spec.banner}] ERROR`, err)
    }
    if (creditsUsed() >= FIRECRAWL_BUDGET) {
      console.warn('\n!!! Firecrawl budget reached — stopping remaining banners.')
      break
    }
  }

  // Dump full captures for the findings doc + test fixtures.
  const outPath = resolve(API_DIR, '..', 'docs/superpowers/research/2026-06-store-binding-captures.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(outcomes, null, 2))

  // Structured summary
  console.log('\n\n======================= SUMMARY =======================')
  console.log(`Firecrawl credits used (est): ${creditsUsed()} / ${FIRECRAWL_BUDGET}`)
  console.log(`Basic scrapes: ${firecrawlScrapes}, action scrapes: ${firecrawlActionScrapes}\n`)
  for (const o of outcomes) {
    console.log(`### ${o.banner}  [${o.domain}]`)
    console.log(`    staple: ${o.staple}`)
    console.log(`    candidate: ${o.candidateTitle ?? '(none)'} @ ${o.candidatePrice ?? 'n/a'}`)
    console.log(`    url: ${o.productUrl ?? '(none)'}`)
    console.log(`    unbound scrape: ${o.unboundScrapeOk ? 'OK' : 'FAILED'}`)
    if (o.unboundIndicators.length) {
      console.log(`    indicators: ${o.unboundIndicators.map(i => JSON.stringify(i.match)).join(' | ')}`)
    }
    for (const l of o.leverResults) {
      console.log(`    lever ${l.lever}: ok=${l.ok} changed=${l.changed} ${l.indicators[0] ? '→ ' + JSON.stringify(l.indicators[0].match) : ''}`)
    }
    console.log(`    VERDICT: ${o.verdict}`)
    if (o.error) console.log(`    error: ${o.error}`)
    console.log('')
  }
  console.log(`Full captures written to: ${outPath}`)
}

main().catch(err => {
  console.error('spike failed:', err)
  process.exit(1)
})
