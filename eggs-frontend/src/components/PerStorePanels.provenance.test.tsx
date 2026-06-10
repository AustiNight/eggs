import { render, screen, fireEvent } from '@testing-library/react'
import PerStorePanels from './PerStorePanels'
import type { StorePlan, StoreItem } from '../types'

const mk = (o: Partial<StoreItem>): StoreItem => ({
  ingredientId: o.ingredientId!, name: o.name!, quantity: 1, unit: 'lb',
  unitPrice: o.unitPrice ?? 1, lineTotal: o.unitPrice ?? 1, confidence: o.confidence!,
  shopUrl: o.shopUrl!, isLoyaltyPrice: false, pricedSize: null, ...o,
})
const stores: StorePlan[] = [{
  storeName: 'H-E-B Plano', storeBanner: 'H-E-B', storeBannerNormalized: 'h-e-b',
  storeType: 'physical', priceSource: 'ai_estimated', subtotal: 0, estimatedTax: 0, grandTotal: 0,
  items: [
    mk({ ingredientId: '1', name: 'chicken', unitPrice: 4.98, confidence: 'real', provenance: 'store_page_verified', verifiedAt: Date.now(), shopUrl: 'https://heb.com/p/1', proofUrl: 'https://heb.com/p/1' }),
    mk({ ingredientId: '2', name: 'thyme', unitPrice: 2.5, confidence: 'estimated', provenance: 'model_estimate', shopUrl: 'https://www.heb.com/search?q=thyme' }),
    mk({ ingredientId: '3', name: 'butter', unitPrice: 3.99, confidence: 'estimated_with_source', provenance: 'page_verified_unbound', verifiedAt: Date.now(), shopUrl: 'https://heb.com/p/butter', proofUrl: 'https://heb.com/p/butter' }),
  ],
}]

it('honesty UI: verified vs online vs estimate render correct labels, subtexts, and links', () => {
  render(<PerStorePanels stores={stores} />)
  fireEvent.click(screen.getByText(/All Stores/i))      // expand section
  fireEvent.click(screen.getByText('H-E-B Plano'))       // expand store card

  expect(screen.getByText('Verified')).toBeInTheDocument()
  expect(screen.getByText('Est.')).toBeInTheDocument()
  expect(screen.getAllByText('Online price').length).toBeGreaterThanOrEqual(1)
  expect(screen.getByText(/estimate — no source found/i)).toBeInTheDocument()
  expect(screen.getByText(/not confirmed for this store/i)).toBeInTheDocument()

  const links = screen.getAllByRole('link')
  const hrefs = links.map(a => a.getAttribute('href') ?? '')
  expect(hrefs).toContain('https://heb.com/p/1')                 // verified → product page
  expect(hrefs.some(h => h.includes('/search?q=thyme'))).toBe(true)  // estimate → search landing
})
