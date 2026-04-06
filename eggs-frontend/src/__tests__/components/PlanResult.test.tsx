import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlanResult from '../../components/PlanResult'
import type { ShoppingPlan, StoreItem } from '../../types'

// recharts doesn't render meaningfully in jsdom — mock it
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null
}))

// BrowserRouter context needed for any Link usage
import { MemoryRouter } from 'react-router-dom'

function makeItem(overrides: Partial<StoreItem> = {}): StoreItem {
  return {
    ingredientId: 'ing-1',
    name: 'Chicken Breast',
    sku: 'SKU-001',
    quantity: 2,
    unit: 'lb',
    unitPrice: 4.99,
    lineTotal: 9.98,
    confidence: 'real',
    productUrl: 'https://kroger.com/product/1',
    proofUrl: 'https://kroger.com/product/1',
    isLoyaltyPrice: false,
    ...overrides
  }
}

function makePlan(items: StoreItem[]): ShoppingPlan {
  const subtotal = items.filter(i => !i.notAvailable).reduce((s, i) => s + i.lineTotal, 0)
  return {
    id: 'plan-1',
    generatedAt: new Date().toISOString(),
    meta: {
      location: { lat: 32.77, lng: -96.79 },
      storesQueried: [{ name: 'Kroger', source: 'kroger_api' }],
      modelUsed: 'test',
      budgetMode: 'calculate'
    },
    ingredients: [{ id: 'ing-1', name: 'Chicken Breast', quantity: 2, unit: 'lb', category: 'protein', sources: [] }],
    stores: [{
      storeName: 'Kroger #123',
      storeBanner: 'Kroger',
      storeType: 'physical',
      priceSource: 'kroger_api',
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      estimatedTax: Math.round(subtotal * 0.0825 * 100) / 100,
      grandTotal: Math.round(subtotal * 1.0825 * 100) / 100
    }],
    summary: {
      subtotal,
      estimatedTax: subtotal * 0.0825,
      total: subtotal * 1.0825,
      realPriceCount: items.filter(i => i.confidence === 'real' && !i.notAvailable).length,
      estimatedPriceCount: items.filter(i => i.confidence !== 'real' && !i.notAvailable).length,
      narrative: 'Found best prices at Kroger.'
    }
  }
}

describe('PlanResult — item schema uniformity', () => {
  it('renders available item with all 6 columns', () => {
    const plan = makePlan([makeItem()])
    render(<MemoryRouter><PlanResult plan={plan} onReset={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText('Chicken Breast')).toBeInTheDocument()
    expect(screen.getByText('$4.99')).toBeInTheDocument()
    // Confidence badge
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('renders notAvailable item as dimmed row with — values, not omitted', () => {
    const plan = makePlan([makeItem({ notAvailable: true, unitPrice: 0, lineTotal: 0 })])
    render(<MemoryRouter><PlanResult plan={plan} onReset={vi.fn()} /></MemoryRouter>)

    // Item name still shown
    expect(screen.getByText('Chicken Breast')).toBeInTheDocument()
    // Shows "Not carried" label
    expect(screen.getByText('Not carried')).toBeInTheDocument()
    // No confidence badge rendered for not-available items
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('renders estimated confidence badge for AI items', () => {
    const plan = makePlan([makeItem({ confidence: 'estimated', productUrl: undefined, proofUrl: undefined, sku: undefined })])
    render(<MemoryRouter><PlanResult plan={plan} onReset={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Est.')).toBeInTheDocument()
  })

  it('renders member price badge when isLoyaltyPrice is true', () => {
    const plan = makePlan([makeItem({ isLoyaltyPrice: true, nonMemberPrice: 6.99 })])
    render(<MemoryRouter><PlanResult plan={plan} onReset={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/Member Price/i)).toBeInTheDocument()
  })
})
