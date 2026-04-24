import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Recharts requires a measured DOM container to render chart internals in jsdom.
// We replace the chart primitives with minimal stubs so assertions can focus on
// data flow (store names appear, empty-array early-return works) rather than SVG.
vi.mock('recharts', async () => {
  const { createElement } = await import('react')
  const actual = await vi.importActual<typeof import('recharts')>('recharts')

  const ResponsiveContainer = ({ children }: { children?: unknown }) =>
    createElement('div', { 'data-testid': 'responsive-container' }, children as never)

  // Render data[].name as text spans so assertions can find them
  const PieChart = ({ children }: { children?: unknown }) =>
    createElement('div', { 'data-testid': 'piechart' }, children as never)

  const Pie = ({ data }: { data?: Array<{ name: string }> }) =>
    createElement('div', { 'data-testid': 'pie' },
      ...(data ?? []).map((d) => createElement('span', { key: d.name }, d.name))
    )

  const Cell = () => null
  const Tooltip = () => null
  const Legend = () => null

  return { ...actual, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend }
})

import CostBreakdownChart from './CostBreakdownChart'

describe('CostBreakdownChart', () => {
  it('renders heading and legend entries for each store', () => {
    render(<CostBreakdownChart data={[
      { name: 'Kroger', value: 11.00 },
      { name: 'Walmart', value: 5.00 },
    ]} />)

    expect(screen.getByText(/cost by store/i)).toBeInTheDocument()
    expect(screen.getByText('Kroger')).toBeInTheDocument()
    expect(screen.getByText('Walmart')).toBeInTheDocument()
  })

  it('renders nothing when data is empty', () => {
    const { container } = render(<CostBreakdownChart data={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a single-store breakdown', () => {
    render(<CostBreakdownChart data={[{ name: 'Kroger', value: 42.00 }]} />)
    expect(screen.getByText('Kroger')).toBeInTheDocument()
  })
})
