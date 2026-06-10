import { describe, it, expect } from 'vitest'
import { makeStripe } from './stripe'

describe('makeStripe', () => {
  it('constructs a Stripe client with a fetch http client (Workers-safe)', () => {
    const s = makeStripe('sk_test_x')
    expect(s).toBeDefined()
    // The fetch-based client avoids Node http; constructEventAsync must exist.
    expect(typeof s.webhooks.constructEventAsync).toBe('function')
  })
})
