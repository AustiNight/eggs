import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import VerifiedTotals, { splitTotals } from './VerifiedTotals'
import type { StorePlan, StoreItem } from '../types'

const mk = (o: Partial<StoreItem>): StoreItem => ({
  ingredientId: o.ingredientId ?? 'x', name: o.name ?? 'x', quantity: 1, unit: 'lb',
  unitPrice: o.lineTotal ?? 1, lineTotal: o.lineTotal ?? 1, confidence: o.confidence ?? 'estimated',
  isLoyaltyPrice: false, pricedSize: null, ...o,
})

const store = (items: StoreItem[]): StorePlan => ({
  storeName: 'S', storeBanner: 'S', storeType: 'physical', priceSource: 'ai_estimated',
  subtotal: 0, estimatedTax: 0, grandTotal: 0, items,
})

describe('splitTotals — WS1', () => {
  it('only api and store_page_verified count as verified; everything else estimated', () => {
    const stores = [store([
      mk({ provenance: 'api', lineTotal: 10 }),
      mk({ provenance: 'store_page_verified', lineTotal: 5 }),
      mk({ provenance: 'page_verified_unbound', lineTotal: 3 }),
      mk({ provenance: 'shopping_index', lineTotal: 2 }),
      mk({ provenance: 'model_estimate', lineTotal: 1 }),
    ])]
    expect(splitTotals(stores)).toEqual({ verified: 15, estimated: 6 })
  })

  it('legacy items without provenance count as estimated', () => {
    const stores = [store([mk({ lineTotal: 4 }), mk({ lineTotal: 6 })])]
    expect(splitTotals(stores)).toEqual({ verified: 0, estimated: 10 })
  })

  it('skips notAvailable items', () => {
    const stores = [store([
      mk({ provenance: 'api', lineTotal: 10 }),
      mk({ provenance: 'api', lineTotal: 99, notAvailable: true }),
    ])]
    expect(splitTotals(stores)).toEqual({ verified: 10, estimated: 0 })
  })

  it('sums across multiple stores', () => {
    const stores = [
      store([mk({ provenance: 'api', lineTotal: 10 })]),
      store([mk({ provenance: 'model_estimate', lineTotal: 4 })]),
    ]
    expect(splitTotals(stores)).toEqual({ verified: 10, estimated: 4 })
  })
})

describe('VerifiedTotals component', () => {
  it('renders verified and estimates lines', () => {
    const stores = [store([
      mk({ provenance: 'api', lineTotal: 12.5 }),
      mk({ provenance: 'model_estimate', lineTotal: 3.5 }),
    ])]
    render(<VerifiedTotals stores={stores} />)
    expect(screen.getByText('$12.50')).toBeInTheDocument()
    expect(screen.getByText('$3.50')).toBeInTheDocument()
  })

  it('omits estimates line when estimated is 0', () => {
    const stores = [store([mk({ provenance: 'api', lineTotal: 8 })])]
    render(<VerifiedTotals stores={stores} />)
    expect(screen.getByText('$8.00')).toBeInTheDocument()
    expect(screen.queryByText(/estimates:/i)).not.toBeInTheDocument()
  })

  it('renders nothing when both totals are 0', () => {
    const { container } = render(<VerifiedTotals stores={[store([])]} />)
    expect(container.firstChild).toBeNull()
  })
})
