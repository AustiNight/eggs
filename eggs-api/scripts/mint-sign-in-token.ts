#!/usr/bin/env tsx
/**
 * Mint a Clerk Sign-In Token for a seeded test user and print a ticket URL
 * that the browser can visit to auto-sign-in (bypassing password, MFA, and
 * device verification).
 *
 * Inputs:
 *   .env.seed.local   → CLERK_SECRET_KEY
 *   .env.test.local   → TEST_USER_CLERK_ID, FREE_TEST_USER_CLERK_ID
 *
 * CLI:
 *   npm run mint-sign-in-token -- [pro|free]   (default: pro)
 *
 * Output: a single URL on stdout, e.g.
 *   https://priceofeggs.online/?__clerk_ticket=<TOKEN>
 *
 * Token lifetime: 5 minutes. Single-use — once consumed the session is set
 * and the ticket is invalidated.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { config as dotenvConfig } from 'dotenv'
import { createClerkClient } from '@clerk/backend'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')

const APP_URL = 'https://priceofeggs.online'

export interface MintOptions {
  userId: string
  expiresInSeconds?: number
  appUrl?: string
}

/**
 * Library entry point — mint a token and return a ready-to-navigate URL.
 * Callers provide CLERK_SECRET_KEY via env.
 */
export async function mintSignInTokenUrl(opts: MintOptions): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) {
    throw new Error('CLERK_SECRET_KEY is not set in the environment')
  }
  const clerk = createClerkClient({ secretKey })
  const result = await clerk.signInTokens.createSignInToken({
    userId: opts.userId,
    expiresInSeconds: opts.expiresInSeconds ?? 300
  })
  const base = (opts.appUrl ?? APP_URL).replace(/\/$/, '')
  // Clerk's SDK consumes __clerk_ticket on the sign-in flow specifically.
  // Landing the ticket at / gets bounced back to /sign-in without consumption.
  return `${base}/sign-in?__clerk_ticket=${encodeURIComponent(result.token)}`
}

// CLI
async function main() {
  const seedEnv = resolve(REPO_ROOT, '.env.seed.local')
  const testEnv = resolve(REPO_ROOT, '.env.test.local')

  if (existsSync(seedEnv)) dotenvConfig({ path: seedEnv })
  if (existsSync(testEnv)) dotenvConfig({ path: testEnv })

  const tier = (process.argv[2] ?? 'pro').toLowerCase()
  const envKey = tier === 'free' ? 'FREE_TEST_USER_CLERK_ID' : 'TEST_USER_CLERK_ID'
  const userId = process.env[envKey]

  if (!userId) {
    console.error(`✖ ${envKey} is not set in .env.test.local`)
    console.error('  Run `npm run seed-test-users` first to populate it.')
    process.exit(1)
  }
  if (!process.env.CLERK_SECRET_KEY) {
    console.error('✖ CLERK_SECRET_KEY is not set in .env.seed.local')
    process.exit(1)
  }

  try {
    const url = await mintSignInTokenUrl({ userId })
    // Single line on stdout so callers can `npm run -s mint-sign-in-token | tail -1`
    console.log(url)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

// Only run main() when invoked directly (not when imported as a library).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
