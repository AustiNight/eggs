// Stripe client factory for the Cloudflare Workers runtime.
// The default SDK uses Node's http + synchronous webhook crypto, both of which
// fail on Workers. We force the fetch HTTP client and callers must use the
// async webhook verifier (constructEventAsync).
import Stripe from 'stripe'

export function makeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    // Pinned to the version the installed stripe@22.2.0 types expect
    // (Stripe.LatestApiVersion === typeof ApiVersion === '2026-05-27.dahlia').
    apiVersion: '2026-05-27.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
  })
}
