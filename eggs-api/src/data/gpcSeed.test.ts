import { describe, it, expect } from 'vitest'
import { GPC_SEED } from './gpcSeed.js'
import type { GpcNode } from './gpcSeed.js'

const nodes = Object.values(GPC_SEED) as GpcNode[]

describe('gpcSeed structural integrity', () => {
  it('has at least 75 entries', () => {
    expect(nodes.length).toBeGreaterThanOrEqual(75)
  })

  it('has no duplicate ids', () => {
    const ids = nodes.map(n => n.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every node id matches its map key', () => {
    for (const [key, node] of Object.entries(GPC_SEED)) {
      expect(node.id).toBe(key)
    }
  })

  it('every node has a non-empty label', () => {
    for (const node of nodes) {
      expect(node.label.trim().length, `node ${node.id} has empty label`).toBeGreaterThan(0)
    }
  })

  it("every node's parent resolves to an existing id or is null", () => {
    for (const node of nodes) {
      if (node.parent !== null) {
        expect(
          GPC_SEED[node.parent],
          `node ${node.id} has unknown parent "${node.parent}"`,
        ).toBeDefined()
      }
    }
  })

  it('every node has a synonyms array (may be empty)', () => {
    for (const node of nodes) {
      expect(Array.isArray(node.synonyms), `node ${node.id} synonyms is not an array`).toBe(true)
    }
  })

  it('at least one root node (parent === null)', () => {
    const roots = nodes.filter(n => n.parent === null)
    expect(roots.length).toBeGreaterThanOrEqual(1)
  })

  it('covers key grocery categories', () => {
    const labels = nodes.map(n => n.label.toLowerCase())
    // Spot-check that top-level categories are present
    const hasMilk = labels.some(l => l.includes('milk'))
    const hasEgg = labels.some(l => l.includes('egg'))
    const hasMeat = labels.some(l => l.includes('meat') || l.includes('chicken') || l.includes('beef'))
    const hasBread = labels.some(l => l.includes('bread'))
    const hasFrozen = labels.some(l => l.includes('frozen'))
    expect(hasMilk).toBe(true)
    expect(hasEgg).toBe(true)
    expect(hasMeat).toBe(true)
    expect(hasBread).toBe(true)
    expect(hasFrozen).toBe(true)
  })
})
