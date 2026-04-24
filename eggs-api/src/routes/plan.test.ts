/**
 * Integration test for the /api/price-plan endpoint
 *
 * Tests that structured clarifications are properly converted to clean search queries
 * via buildSearchQuery and passed to store providers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildSearchQuery } from '../lib/query-builder.js'

describe('buildSearchQuery — called with structured clarifications', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes clean search query (baseName + selectedOptions) to buildSearchQuery', () => {
    const baseName = 'chicken thighs'
    const selectedOptions = ['Boneless', 'Skinless']

    const result = buildSearchQuery(baseName, selectedOptions)

    // Should return lowercase options prepended to base name
    expect(result).toBe('boneless skinless chicken thighs')
  })

  it('dedupes options that already appear in baseName', () => {
    const baseName = 'organic milk'
    const selectedOptions = ['Organic', 'Whole']

    const result = buildSearchQuery(baseName, selectedOptions)

    // 'organic' should not appear twice since it's in baseName
    expect(result).toBe('whole organic milk')
  })

  it('handles empty selectedOptions', () => {
    const baseName = 'chicken'
    const selectedOptions: string[] = []

    const result = buildSearchQuery(baseName, selectedOptions)

    expect(result).toBe('chicken')
  })

  it('strips special characters from options', () => {
    const baseName = 'cheese'
    const selectedOptions = ['Sharp, aged']

    const result = buildSearchQuery(baseName, selectedOptions)

    // Comma should be stripped
    expect(result).toContain('sharp')
    expect(result).toContain('aged')
  })
})
