import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubstituteBadge from './SubstituteBadge'

describe('SubstituteBadge', () => {
  it('renders nothing for category=exact', () => {
    const { container } = render(<SubstituteBadge grade={{ score: 95, category: 'exact', reason: '' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders Substitute pill with reason in tooltip for category=substitute', () => {
    render(<SubstituteBadge grade={{ score: 70, category: 'substitute', reason: 'Different brand, similar size.' }} />)
    const badge = screen.getByText(/Substitute/)
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[title]')?.getAttribute('title')).toBe('Different brand, similar size.')
  })

  it('renders prominent error badge for category=wrong (regression guard)', () => {
    render(<SubstituteBadge grade={{ score: 10, category: 'wrong', reason: 'Yogurt is not a kiwi.' }} />)
    expect(screen.getByText(/Wrong product/)).toBeInTheDocument()
  })
})
