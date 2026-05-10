import { describe, it, expect } from 'vitest'
import { parseIngredient } from './parseIngredient'

describe('parseIngredient', () => {
  it('leading qty + unit + name', () => {
    expect(parseIngredient('2 gallons soy milk')).toEqual({ name: 'soy milk', quantity: 2, unit: 'gal', rawInput: '2 gallons soy milk' })
  })
  it('leading qty + bare name (no unit)', () => {
    expect(parseIngredient('2 lettuce')).toEqual({ name: 'lettuce', quantity: 2, unit: 'each', rawInput: '2 lettuce' })
  })
  it('trailing comma + qty + unit', () => {
    expect(parseIngredient('lettuce, 2 heads')).toEqual({ name: 'lettuce', quantity: 2, unit: 'head', rawInput: 'lettuce, 2 heads' })
  })
  it('trailing parenthetical', () => {
    expect(parseIngredient('red seedless grapes (1 lb)')).toEqual({ name: 'red seedless grapes', quantity: 1, unit: 'lb', rawInput: 'red seedless grapes (1 lb)' })
  })
  it('trailing without comma', () => {
    expect(parseIngredient('sliced smoked turkey breast 2 lbs')).toEqual({ name: 'sliced smoked turkey breast', quantity: 2, unit: 'lb', rawInput: 'sliced smoked turkey breast 2 lbs' })
  })
  it('parenthetical with each unit', () => {
    expect(parseIngredient('X-Large Eggs (12 each)')).toEqual({ name: 'X-Large Eggs', quantity: 12, unit: 'each', rawInput: 'X-Large Eggs (12 each)' })
  })
  it('bare name → 1 each', () => {
    expect(parseIngredient('eggs')).toEqual({ name: 'eggs', quantity: 1, unit: 'each', rawInput: 'eggs' })
  })
  it('preserves apostrophes', () => {
    expect(parseIngredient("Duke's Mayonnaise")).toEqual({ name: "Duke's Mayonnaise", quantity: 1, unit: 'each', rawInput: "Duke's Mayonnaise" })
  })
  it('preserves descriptors (organic, whole)', () => {
    expect(parseIngredient('organic whole milk')).toEqual({ name: 'organic whole milk', quantity: 1, unit: 'each', rawInput: 'organic whole milk' })
  })
  it('handles fractional quantity', () => {
    expect(parseIngredient('1.5 lb ground beef')).toEqual({ name: 'ground beef', quantity: 1.5, unit: 'lb', rawInput: '1.5 lb ground beef' })
  })
  it('trims whitespace from input but preserves rawInput', () => {
    const result = parseIngredient('  2 gallons soy milk  ')
    expect(result.name).toBe('soy milk')
    expect(result.rawInput).toBe('  2 gallons soy milk  ')  // verbatim
  })
})
