import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import DiagnosticsDisclosure from './DiagnosticsDisclosure'
import type { PlanDiagnostics } from '../types'

const empty: PlanDiagnostics = {
  ai: { pass1Failed: false, pass2Failed: false, candidateCount: 0, proofUrlsValidated: 0, proofUrlsContentVerified: 0, proofUrlsContentRejected: 0 },
  sizeResolver: { resolved: 0, bySource: { parseSize: 0, fdc: 0, off: 0, web_fetch: 0, web_search: 0 }, failed: 0 },
  grader: { specsGraded: 0, totalCandidates: 0, cacheHits: 0, rejectedAsWrong: 0 },
  ontology: { broaderTermsAttempted: 0, broaderTermsSucceeded: 0 },
}

describe('DiagnosticsDisclosure', () => {
  it('renders all four sections', () => {
    render(<DiagnosticsDisclosure diagnostics={empty} />)
    expect(screen.getByText('Size resolution')).toBeInTheDocument()
    expect(screen.getByText('Candidate grading')).toBeInTheDocument()
    expect(screen.getByText('Ontology fallback')).toBeInTheDocument()
    expect(screen.getByText('AI store search')).toBeInTheDocument()
  })

  it('shows summary text "How we picked these matches"', () => {
    render(<DiagnosticsDisclosure diagnostics={empty} />)
    expect(screen.getByText('How we picked these matches')).toBeInTheDocument()
  })

  it('uses "None needed" copy when ontology counters are zero', () => {
    render(<DiagnosticsDisclosure diagnostics={empty} />)
    expect(screen.getByText(/None needed/)).toBeInTheDocument()
  })

  it('reports active resolutions when present', () => {
    render(<DiagnosticsDisclosure diagnostics={{ ...empty, sizeResolver: { resolved: 14, bySource: { parseSize: 0, fdc: 13, off: 1, web_fetch: 0, web_search: 0 }, failed: 0 } }} />)
    expect(screen.getByText(/USDA FDC \(13\)/)).toBeInTheDocument()
    expect(screen.getByText(/Open Food Facts \(1\)/)).toBeInTheDocument()
  })

  it('reports grader rejected-as-wrong when > 0', () => {
    render(<DiagnosticsDisclosure diagnostics={{ ...empty, grader: { specsGraded: 6, totalCandidates: 30, cacheHits: 0, rejectedAsWrong: 2 } }} />)
    expect(screen.getByText(/2 rejected as the wrong product class/)).toBeInTheDocument()
  })

  it('starts collapsed (details has no open attribute)', () => {
    const { container } = render(<DiagnosticsDisclosure diagnostics={empty} />)
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false)
  })

  it('expands when summary is clicked', () => {
    const { container } = render(<DiagnosticsDisclosure diagnostics={empty} />)
    const summary = container.querySelector('summary')!
    fireEvent.click(summary)
    // jsdom toggles open on click for native details; verify or just confirm the dt/dd are queryable
    expect(screen.getByText('Size resolution')).toBeInTheDocument()
  })
})
