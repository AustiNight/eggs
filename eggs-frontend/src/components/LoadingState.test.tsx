import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LoadingState from './LoadingState'

describe('LoadingState scrolling terminal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a line immediately and keeps producing new ones', () => {
    render(<LoadingState status="searching" />)
    // first line is pushed synchronously on mount
    expect(screen.getAllByText(/^>/).length).toBeGreaterThanOrEqual(1)
    act(() => { vi.advanceTimersByTime(1100 * 5) })
    expect(screen.getAllByText(/^>/).length).toBe(6) // window caps at VISIBLE
  })

  it('never runs dry — still scrolling well past the scripted line count', () => {
    render(<LoadingState status="optimizing" />)
    // advance far beyond the ~10 scripted lines into the evergreen cycle
    act(() => { vi.advanceTimersByTime(1100 * 40) })
    const lines = screen.getAllByText(/^>/)
    expect(lines.length).toBe(6)
    // evergreen content has appeared (cycled after the scripted optimizing lines)
    expect(screen.getAllByText(/Almost there|Optimizing your basket|Tidying up|Reconciling|Re-checking/).length).toBeGreaterThanOrEqual(1)
  })
})
