import { describe, it, expect } from 'vitest'
import { buildSearchQuery } from './query-builder'

describe('buildSearchQuery', () => {
  it('returns baseName unchanged when no options selected', () => {
    expect(buildSearchQuery('chicken thighs', [])).toBe('chicken thighs')
  })

  it('prepends options in front of baseName with single spaces', () => {
    expect(buildSearchQuery('chicken thighs', ['Boneless', 'Skinless']))
      .toBe('boneless skinless chicken thighs')
  })

  it('lowercases options and trims whitespace', () => {
    expect(buildSearchQuery('  Chicken Thighs  ', ['  Organic  ']))
      .toBe('organic Chicken Thighs')
  })

  it('strips parentheses and commas that would confuse store search', () => {
    expect(buildSearchQuery('cheese (sharp)', ['Cheddar, aged']))
      .toBe('cheddar aged cheese sharp')
  })

  it('dedupes options that already appear in baseName', () => {
    expect(buildSearchQuery('organic milk', ['Organic', 'Whole']))
      .toBe('whole organic milk')
  })

  it('returns baseName when selectedOptions is undefined (defensive)', () => {
    expect(buildSearchQuery('chicken thighs', undefined)).toBe('chicken thighs')
  })

  it('returns baseName when selectedOptions is null (defensive)', () => {
    expect(buildSearchQuery('chicken thighs', null)).toBe('chicken thighs')
  })
})
