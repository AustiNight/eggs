import { test as base, type Page } from '@playwright/test'

/**
 * Extend Playwright's base test with an authenticated page fixture.
 *
 * For now this navigates through the Clerk sign-in UI.
 * Once Clerk supports programmatic auth tokens, swap this for
 * storageState injection to skip the UI entirely.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const email = process.env.TEST_USER_EMAIL ?? ''
    const password = process.env.TEST_USER_PASSWORD ?? ''

    if (!email || !password) {
      throw new Error('TEST_USER_EMAIL and TEST_USER_PASSWORD must be set for E2E tests')
    }

    await page.goto('/sign-in')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|continue/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })

    await use(page)
  }
})

export { expect } from '@playwright/test'
