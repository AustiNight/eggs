import { defineConfig, devices } from '@playwright/test'

/**
 * E2E test config for E.G.G.S.
 * Smoke tests (@smoke tag) run on every PR.
 * Full suite runs nightly and on merge to main.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['html', { open: 'on-failure' }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    // Web — primary browsers
    { name: 'chromium',  use: { ...devices['Desktop Chrome']  } },
    { name: 'firefox',   use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',    use: { ...devices['Desktop Safari']  } },

    // Mobile web — viewport + touch simulation
    { name: 'mobile-chrome',  use: { ...devices['Pixel 7']       } },
    { name: 'mobile-safari',  use: { ...devices['iPhone 15 Pro'] } }
  ],

  // Start the Vite dev server for local E2E runs
  webServer: process.env.CI ? undefined : {
    command: 'npm --prefix eggs-frontend run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
})
