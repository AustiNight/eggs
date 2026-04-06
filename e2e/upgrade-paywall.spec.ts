import { test, expect } from './fixtures/test'

/**
 * Upgrade paywall & tier gating tests.
 * These require a free-tier test account (separate from the dev account).
 * Set FREE_TEST_USER_EMAIL / FREE_TEST_USER_PASSWORD in CI secrets.
 */

test.describe('Upgrade Paywall', () => {

  test('pro user does not see upgrade prompts on dashboard @smoke', async ({ authedPage: page }) => {
    // The dev/pro account should never see "Upgrade to Pro" on the dashboard
    await expect(page.getByRole('button', { name: /Upgrade to Pro/i })).not.toBeVisible()
    await expect(page.getByText(/Free Tier Usage/i)).not.toBeVisible()
  })

  test('pro user sees PRO badge in header @smoke', async ({ authedPage: page }) => {
    await expect(page.getByText('PRO')).toBeVisible()
  })

  test('pro user settings page shows correct tier', async ({ authedPage: page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Pro')).toBeVisible()
  })

  // The following tests require a free-tier account and a seeded state
  // where the monthly limit has been reached. Run nightly with free test account.

  test.skip('free user at limit sees upgrade paywall after search', async ({ page }) => {
    // TODO: Set up free test account fixture
    // 1. Sign in as free test user
    // 2. Navigate to /plan
    // 3. Submit a list
    // 4. Expect paywall card with free vs pro comparison
    await expect(page.getByText(/You've hit your free limit/i)).toBeVisible()
    await expect(page.getByText('3 plans / month')).toBeVisible()
    await expect(page.getByText('Unlimited plans')).toBeVisible()
  })

  test.skip('upgrade CTA on paywall navigates to settings', async ({ page }) => {
    // TODO: Set up free-at-limit fixture
    await page.getByRole('button', { name: /Upgrade to Pro/i }).click()
    await page.waitForURL('**/settings')
  })

})
