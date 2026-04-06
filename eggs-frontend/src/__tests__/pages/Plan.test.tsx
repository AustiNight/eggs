import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks (must be declared before importing the component) ─────────────────

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: () => Promise.resolve('mock-token') })
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../services/storageService', () => ({ saveToHistory: vi.fn() }))

vi.mock('../../lib/api', async () => {
  const { ApiError } = await import('../../lib/api')
  return {
    ApiError,
    clarifyIngredients: vi.fn(),
    generatePlan: vi.fn()
  }
})

vi.mock('../../components/ShoppingListInput', () => ({
  default: ({ onStartSearch }: { onStartSearch: () => void }) => (
    <button onClick={onStartSearch} data-testid="start-search">Search</button>
  )
}))

vi.mock('../../components/LoadingState', () => ({
  default: ({ status }: { status: string }) => <div data-testid="loading">{status}</div>
}))

vi.mock('../../components/PlanResult', () => ({
  default: () => <div data-testid="plan-result">Results</div>
}))

vi.mock('../../components/SettingsPanel', () => ({
  default: () => <div>Settings</div>
}))

vi.mock('../../components/ClarificationModal', () => ({
  default: () => <div>Clarify</div>
}))

// Geolocation mock
const mockGeolocation = { getCurrentPosition: vi.fn((_s, e) => e({ code: 1 })) }
Object.defineProperty(navigator, 'geolocation', { value: mockGeolocation, writable: true })

// ─── Import after mocks ───────────────────────────────────────────────────────

import Plan from '../../pages/Plan'
import { clarifyIngredients, generatePlan, ApiError } from '../../lib/api'

const mockClarify = vi.mocked(clarifyIngredients)
const mockGenerate = vi.mocked(generatePlan)

function renderPlan() {
  return render(<MemoryRouter><Plan /></MemoryRouter>)
}

describe('Plan page — upgrade paywall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClarify.mockResolvedValue({ clarifications: null })
  })

  it('shows upgrade paywall card when API returns 403', async () => {
    mockGenerate.mockRejectedValue(new ApiError(403, 'free_limit_reached'))
    renderPlan()

    fireEvent.click(screen.getByTestId('start-search'))

    await waitFor(() => {
      expect(screen.getByText(/You've hit your free limit/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Button specifically (not just any text match)
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeInTheDocument()
    expect(screen.getByText(/3 plans \/ month/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Unlimited plans/i).length).toBeGreaterThan(0)
  })

  it('shows generic error message for non-403 failures', async () => {
    mockGenerate.mockRejectedValue(new Error('Network error'))
    renderPlan()

    fireEvent.click(screen.getByTestId('start-search'))

    await waitFor(() => {
      expect(screen.getByText(/Failed to generate a shopping plan/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.queryByText(/You've hit your free limit/i)).not.toBeInTheDocument()
  })

  it('"Back to my list" resets to idle state', async () => {
    mockGenerate.mockRejectedValue(new ApiError(403, 'free_limit_reached'))
    renderPlan()

    fireEvent.click(screen.getByTestId('start-search'))
    await waitFor(() => screen.getByText(/You've hit your free limit/i), { timeout: 3000 })

    fireEvent.click(screen.getByText(/Back to my list/i))
    expect(screen.queryByText(/You've hit your free limit/i)).not.toBeInTheDocument()
  })

  it('"Upgrade to Pro" navigates to /settings', async () => {
    mockGenerate.mockRejectedValue(new ApiError(403, 'free_limit_reached'))
    renderPlan()

    fireEvent.click(screen.getByTestId('start-search'))
    await waitFor(() => screen.getByRole('button', { name: /Upgrade to Pro/i }), { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: /Upgrade to Pro/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/settings')
  })
})
