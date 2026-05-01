import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PackageDetails from './PackageDetails'
import type { StoreItem } from '../types'

const baseItem = (overrides: Partial<StoreItem> = {}): StoreItem => ({
  ingredientId: 'i1', name: 'Test', sku: 'sku', quantity: 1, unit: 'lb',
  unitPrice: 4.99, lineTotal: 4.99, confidence: 'real',
  isLoyaltyPrice: false, ...overrides,
} as StoreItem)

describe('PackageDetails', () => {
  it('renders count + size + per-gram for a mass-based item', () => {
    render(<PackageDetails ingredient={{ quantity: 1, unit: 'lb' }} item={baseItem({ pricedSize: { quantity: 1, unit: 'lb' } })} />)
    expect(screen.getByText(/1 unit/)).toBeInTheDocument()
    expect(screen.getByText(/1 lb/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.\d{4}\/g/)).toBeInTheDocument()
  })

  it('renders multiple packages when ingredient quantity exceeds package', () => {
    render(<PackageDetails ingredient={{ quantity: 5, unit: 'lb' }} item={baseItem({ pricedSize: { quantity: 1.25, unit: 'lb' } })} />)
    expect(screen.getByText(/4 units/)).toBeInTheDocument()  // ceil(5/1.25)
  })

  it('renders comparison note when sizes differ', () => {
    render(<PackageDetails ingredient={{ quantity: 1, unit: 'lb' }} item={baseItem({ pricedSize: { quantity: 1.25, unit: 'lb' } })} />)
    expect(screen.getByText(/slightly more/)).toBeInTheDocument()
  })

  it('renders per-mL for volume packages (gallon → mL)', () => {
    render(<PackageDetails ingredient={{ quantity: 1, unit: 'gallon' }} item={baseItem({ unit: 'gallon', pricedSize: { quantity: 1, unit: 'gallon' } })} />)
    expect(screen.getByText(/\$0\.\d{4}\/mL/)).toBeInTheDocument()
  })

  it('falls back to per-each pricing for count packages', () => {
    render(<PackageDetails ingredient={{ quantity: 12, unit: 'each' }} item={baseItem({ unit: 'each', pricedSize: { quantity: 6, unit: 'each' } })} />)
    expect(screen.getByText(/\$\d+\.\d{2}\/each/)).toBeInTheDocument()
  })

  it('renders fallback line when pricedSize is null', () => {
    render(<PackageDetails ingredient={{ quantity: 1, unit: 'lb' }} item={baseItem({ pricedSize: null })} />)
    expect(screen.getByText(/\$4\.99 ea/)).toBeInTheDocument()
  })

  it('omits comparison note when sizes match', () => {
    render(<PackageDetails ingredient={{ quantity: 1, unit: 'lb' }} item={baseItem({ pricedSize: { quantity: 1, unit: 'lb' } })} />)
    expect(screen.queryByText(/slightly more|buying.*packages/)).toBeNull()
  })
})
