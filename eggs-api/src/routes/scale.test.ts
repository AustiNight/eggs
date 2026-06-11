import { describe, it, expect } from 'vitest'
import { extractJsonObject } from './scale'

describe('extractJsonObject', () => {
  it('passes through clean JSON', () => {
    expect(extractJsonObject('{"ingredients":[]}')).toBe('{"ingredients":[]}')
  })
  it('strips ```json fences', () => {
    expect(JSON.parse(extractJsonObject('```json\n{"a":1}\n```'))).toEqual({ a: 1 })
  })
  it('strips bare ``` fences', () => {
    expect(JSON.parse(extractJsonObject('```\n{"a":1}\n```'))).toEqual({ a: 1 })
  })
  it('trims leading prose before the object', () => {
    expect(JSON.parse(extractJsonObject('Here is your list:\n{"a":1}'))).toEqual({ a: 1 })
  })
  it('trims trailing prose after the object', () => {
    expect(JSON.parse(extractJsonObject('{"a":1}\nLet me know if you need more.'))).toEqual({ a: 1 })
  })
})
