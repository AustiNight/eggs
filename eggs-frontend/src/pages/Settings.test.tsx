import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { UserProfile } from '../types'

// ─── Mocks (declared before importing the component) ─────────────────────────

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: () => Promise.resolve('mock-token') }),
  UserButton: () => <div data-testid="user-button" />
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../lib/api', () => ({
  getMe: vi.fn(),
  updateMe: vi.fn(),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn()
}))

import Settings from './Settings'
import { getMe } from '../lib/api'

const mockGetMe = vi.mocked(getMe)

function baseProfile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-1',
    email: 'chef@x.com',
    display_name: 'Chef',
    default_location_lat: null,
    default_location_lng: null,
    default_location_label: null,
    default_settings: {},
    avoid_stores: [],
    avoid_brands: [],
    ai_provider: null,
    subscription_tier: 'free',
    subscription_status: 'active',
    ...over
  }
}

function renderSettings() {
  return render(<MemoryRouter><Settings /></MemoryRouter>)
}

describe('Settings — billing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('free tier shows "Upgrade to Pro"', async () => {
    mockGetMe.mockResolvedValue(baseProfile({ subscription_tier: 'free' }))
    renderSettings()
    await waitFor(() => expect(screen.getByText(/Upgrade to Pro/i)).toBeInTheDocument())
    expect(screen.queryByText(/Manage subscription/i)).not.toBeInTheDocument()
  })

  it('pro tier shows "Manage subscription" and renewal date', async () => {
    mockGetMe.mockResolvedValue(baseProfile({
      subscription_tier: 'pro',
      subscription_status: 'active',
      subscription_period_end: '2026-12-31T00:00:00.000Z'
    }))
    renderSettings()
    await waitFor(() => expect(screen.getByText(/Manage subscription/i)).toBeInTheDocument())
    expect(screen.queryByText(/Upgrade to Pro/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Renews/i)).toBeInTheDocument()
  })
})
