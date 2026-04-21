// ─── InstacartIdpClient — Instacart Developer Platform Recipe Page API ────────
//
// Creates a shoppable Instacart URL for a list of ingredients via the IDP
// Recipe Page API.  This is the no-approval surface: any IDP public customer
// can POST /idp/v1/products/recipe and receive back a products_link_url.
//
// Docs: https://developers.instacart.com/docs/idp/products/recipe
// API key: self-serve at https://developers.instacart.com
//
// Design notes:
//   - No caching: each plan gets a fresh, short-lived Instacart URL.
//   - Silent-fail: the caller (plan.ts) wraps in try/catch so a failed IDP
//     call never blocks plan generation.
//   - fetchImpl injection: follows the UsdaFdcClient pattern for testability.

import { toInstacartLineItem } from '../types/spec.js'
import type { ShoppableItemSpec, InstacartLineItem } from '../types/spec.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IdpClientOptions {
  /** Instacart IDP API key — obtain at https://developers.instacart.com */
  apiKey: string
  /** Optional fetch override for testing; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Override base URL for testing; defaults to 'https://connect.instacart.com'. */
  baseUrl?: string
}

export interface ShoppingListPageResult {
  productsLinkUrl: string
}

// ─── Internal wire types ─────────────────────────────────────────────────────

interface RecipePageRequestBody {
  title: string
  image_url: null
  link_type: 'recipe'
  instructions: []
  ingredients: InstacartLineItem[]
  landing_page_configuration: {
    partner_linkback_url: string | null
    enable_pantry_items: false
  }
}

interface RecipePageResponse {
  products_link_url?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://connect.instacart.com'
const RECIPE_ENDPOINT = '/idp/v1/products/recipe'

// ─── Client ───────────────────────────────────────────────────────────────────

export class IdpClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(opts: IdpClientOptions) {
    this.apiKey = opts.apiKey
    // Arrow wrapper avoids "Illegal invocation" on Cloudflare Workers when the
    // default unbound `globalThis.fetch` is called as a method.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
  }

  /**
   * POST /idp/v1/products/recipe — creates a shoppable Instacart URL for the
   * given list of ingredients.
   *
   * Throws on any non-2xx response or when the response body is malformed.
   * Callers should wrap in try/catch to allow fire-and-forget usage.
   */
  async createShoppingListPage(
    specs: ShoppableItemSpec[],
    title: string,
    linkbackUrl: string | null
  ): Promise<ShoppingListPageResult> {
    const ingredients = specs.map(toInstacartLineItem)

    const body: RecipePageRequestBody = {
      title,
      image_url: null,
      link_type: 'recipe',
      instructions: [],
      ingredients,
      landing_page_configuration: {
        partner_linkback_url: linkbackUrl,
        enable_pantry_items: false,
      },
    }

    const url = `${this.baseUrl}${RECIPE_ENDPOINT}`

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(
        `Instacart IDP Recipe Page API returned ${res.status} ${res.statusText}. ` +
        `Check your INSTACART_IDP_API_KEY and request payload.`
      )
    }

    const data = (await res.json()) as RecipePageResponse

    if (!data.products_link_url) {
      throw new Error(
        `Instacart IDP response was missing products_link_url. ` +
        `Response body: ${JSON.stringify(data)}`
      )
    }

    return { productsLinkUrl: data.products_link_url }
  }
}
