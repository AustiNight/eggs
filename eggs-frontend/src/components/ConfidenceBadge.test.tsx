import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfidenceBadge } from './ConfidenceBadge'

describe('ConfidenceBadge — WS1 provenance mapping', () => {
  it('api → Verified', () => {
    render(<ConfidenceBadge confidence="real" provenance="api" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('store_page_verified → Verified', () => {
    render(<ConfidenceBadge confidence="real" provenance="store_page_verified" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('page_verified_unbound → Online price', () => {
    render(<ConfidenceBadge confidence="estimated_with_source" provenance="page_verified_unbound" />)
    expect(screen.getByText('Online price')).toBeInTheDocument()
  })

  it('shopping_index → Online price', () => {
    render(<ConfidenceBadge confidence="estimated_with_source" provenance="shopping_index" />)
    expect(screen.getByText('Online price')).toBeInTheDocument()
  })

  it('model_estimate → Est.', () => {
    render(<ConfidenceBadge confidence="estimated" provenance="model_estimate" />)
    expect(screen.getByText('Est.')).toBeInTheDocument()
  })

  it('provenance wins over confidence when both present', () => {
    // confidence "estimated" would yield "Est.", but provenance "api" wins → "Verified"
    render(<ConfidenceBadge confidence="estimated" provenance="api" />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.queryByText('Est.')).not.toBeInTheDocument()
  })

  it('legacy fallback: no provenance → uses confidence label', () => {
    render(<ConfidenceBadge confidence="real" />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('legacy fallback: unknown provenance → uses confidence label', () => {
    render(<ConfidenceBadge confidence="estimated_with_source" provenance="totally_unknown" />)
    expect(screen.getByText('Sourced')).toBeInTheDocument()
  })

  it('unknown confidence and no provenance → defaults to Est.', () => {
    render(<ConfidenceBadge confidence="nonsense" />)
    expect(screen.getByText('Est.')).toBeInTheDocument()
  })
})
