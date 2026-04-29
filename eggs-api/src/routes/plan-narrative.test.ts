/**
 * Tests for plan-narrative.ts
 *
 * Verifies:
 *  - detectHumorOpportunity correctly classifies ingredient lists
 *  - buildNarrativePrompt encodes deterministic facts into the prompt text
 *  - fallbackNarrative produces honest, no-claim text without LLM
 */

import { describe, it, expect } from 'vitest'
import {
  detectHumorOpportunity,
  buildNarrativePrompt,
  fallbackNarrative,
  type NarrativeFacts,
} from './plan-narrative.js'

// ── detectHumorOpportunity ───────────────────────────────────────────────────

describe('detectHumorOpportunity', () => {
  it('returns "pun" when a pun-target word is in the list', () => {
    expect(detectHumorOpportunity(['chicken breast', 'lettuce', 'olive oil'])).toBe('pun')
  })

  it('returns "pun" for plural pun-targets (mushrooms)', () => {
    expect(detectHumorOpportunity(['mushrooms', 'garlic', 'onion'])).toBe('pun')
  })

  it('returns "pun" for thyme', () => {
    expect(detectHumorOpportunity(['fresh thyme', 'butter', 'salt'])).toBe('pun')
  })

  it('returns "lifestyle" for kombucha', () => {
    expect(detectHumorOpportunity(['kombucha', 'chicken', 'rice'])).toBe('lifestyle')
  })

  it('returns "lifestyle" for kefir', () => {
    expect(detectHumorOpportunity(['kefir', 'oats', 'honey'])).toBe('lifestyle')
  })

  it('returns "lifestyle" for chia seeds', () => {
    expect(detectHumorOpportunity(['chia seeds', 'almond milk', 'banana'])).toBe('lifestyle')
  })

  it('returns "lifestyle" for spirulina', () => {
    expect(detectHumorOpportunity(['spirulina powder', 'apple', 'ginger'])).toBe('lifestyle')
  })

  it('returns "lifestyle" when "organic" appears twice across ingredient names', () => {
    expect(detectHumorOpportunity(['organic spinach', 'organic chicken breast', 'rice'])).toBe('lifestyle')
  })

  it('returns "none" for a plain grocery list with no triggers', () => {
    expect(detectHumorOpportunity(['chicken', 'rice', 'onion', 'garlic', 'tomatoes'])).toBe('none')
  })

  it('returns "none" for an empty list', () => {
    expect(detectHumorOpportunity([])).toBe('none')
  })

  it('pun takes priority over lifestyle when both apply', () => {
    // "sage" is a pun-target AND "kefir" is lifestyle — pun wins
    expect(detectHumorOpportunity(['fresh sage', 'kefir'])).toBe('pun')
  })

  it('is case-insensitive for pun targets', () => {
    expect(detectHumorOpportunity(['Fresh Rosemary', 'olive oil'])).toBe('pun')
  })
})

// ── buildNarrativePrompt ─────────────────────────────────────────────────────

describe('buildNarrativePrompt', () => {
  const baseFacts: NarrativeFacts = {
    requested: 8,
    matched: 6,
    unmatchedNames: ['turkey breast', 'heavy cream'],
    stores: [
      { name: 'Kroger', source: 'live Kroger API', subtotal: 42.5 },
      { name: 'Walmart', source: 'live Walmart API', subtotal: 39.99 },
    ],
    total: 47.32,
    realCount: 5,
    estimatedCount: 1,
  }

  it('includes the matched/requested counts', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toContain('6 of 8')
  })

  it('lists all unmatched item names', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toContain('turkey breast')
    expect(prompt).toContain('heavy cream')
  })

  it('includes each store name and subtotal', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toContain('Kroger')
    expect(prompt).toContain('$42.50')
    expect(prompt).toContain('Walmart')
    expect(prompt).toContain('$39.99')
  })

  it('includes real vs estimated price counts', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toContain('5 live')
    expect(prompt).toContain('1 estimated')
  })

  it('includes total', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toContain('$47.32')
  })

  it('instructs the LLM never to claim 100% confirmed', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toMatch(/never.*100%|100%.*never/i)
  })

  it('instructs the LLM to mention unmatched items by name', () => {
    const prompt = buildNarrativePrompt(baseFacts)
    expect(prompt).toMatch(/unmatched|not found|could not/i)
  })

  it('adds humor hint when ingredientNames contains a pun target', () => {
    const facts: NarrativeFacts = { ...baseFacts, ingredientNames: ['fresh thyme', 'garlic'] }
    const prompt = buildNarrativePrompt(facts)
    expect(prompt).toMatch(/pun|humor|wordplay/i)
  })

  it('adds lifestyle hint when ingredientNames contains a lifestyle marker', () => {
    const facts: NarrativeFacts = { ...baseFacts, ingredientNames: ['kombucha', 'chicken'] }
    const prompt = buildNarrativePrompt(facts)
    expect(prompt).toMatch(/lifestyle|free spirit|nature|judge/i)
  })

  it('omits humor hint when no triggers present', () => {
    const facts: NarrativeFacts = { ...baseFacts, ingredientNames: ['chicken', 'rice'] }
    const prompt = buildNarrativePrompt(facts)
    // no humor instruction
    expect(prompt).not.toMatch(/pun|wordplay/i)
    expect(prompt).not.toMatch(/lifestyle|free spirit/i)
  })

  it('handles zero unmatched items gracefully', () => {
    const allMatchedFacts: NarrativeFacts = {
      ...baseFacts,
      matched: 8,
      unmatchedNames: [],
    }
    const prompt = buildNarrativePrompt(allMatchedFacts)
    expect(prompt).toContain('8 of 8')
  })
})

// ── fallbackNarrative ────────────────────────────────────────────────────────

describe('fallbackNarrative', () => {
  const baseFacts: NarrativeFacts = {
    requested: 8,
    matched: 6,
    unmatchedNames: ['turkey breast', 'heavy cream'],
    stores: [
      { name: 'Kroger', source: 'live Kroger API', subtotal: 42.5 },
    ],
    total: 47.32,
    realCount: 4,
    estimatedCount: 2,
  }

  it('returns a non-empty string', () => {
    expect(fallbackNarrative(baseFacts).length).toBeGreaterThan(0)
  })

  it('mentions the real and estimated price counts', () => {
    const text = fallbackNarrative(baseFacts)
    expect(text).toMatch(/4.*live|live.*4/i)
    expect(text).toMatch(/2.*estimated|estimated.*2/i)
  })

  it('mentions unmatched items by name', () => {
    const text = fallbackNarrative(baseFacts)
    expect(text).toContain('turkey breast')
    expect(text).toContain('heavy cream')
  })

  it('does NOT contain "100%"', () => {
    const text = fallbackNarrative(baseFacts)
    expect(text).not.toContain('100%')
  })

  it('works when there are no unmatched items', () => {
    const facts: NarrativeFacts = { ...baseFacts, matched: 8, unmatchedNames: [] }
    const text = fallbackNarrative(facts)
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('100%')
  })
})
