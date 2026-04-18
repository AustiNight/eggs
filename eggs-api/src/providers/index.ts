import type { Context } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

/**
 * Anthropic server-side tool definition. Accepts the versioned `type` identifier
 * (e.g. `web_search_20260209`, `web_fetch_20260209`) and any tool-specific options.
 */
export interface AnthropicTool {
  type: string
  name: string
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  [key: string]: unknown
}

/** A single URL the model cited from its web_search / web_fetch results. */
export interface Citation {
  url: string
  title?: string
  citedText?: string
}

export interface CompletionParams {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  jsonMode?: boolean
  /** Server-side tools (e.g. web_search, web_fetch). Incompatible with jsonMode prefill. */
  tools?: AnthropicTool[]
}

export interface CompletionResult {
  content: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
  /** URLs the model retrieved via web_search / web_fetch, when tools were enabled. */
  citations?: Citation[]
}

export interface ModelProvider {
  complete(params: CompletionParams): Promise<CompletionResult>
}

export function getProvider(
  c: Context<HonoEnv>,
  user?: { subscription_tier: string }
): ModelProvider {
  const byokKey = c.req.header('X-AI-Key')
  const byokProvider = c.req.header('X-AI-Provider')

  if (byokKey && user?.subscription_tier === 'pro') {
    if (byokProvider === 'openai') return new OpenAIProvider(byokKey)
    if (byokProvider === 'anthropic') return new AnthropicProvider(byokKey)
  }

  return new AnthropicProvider(c.env.ANTHROPIC_API_KEY)
}

export { AnthropicProvider, OpenAIProvider }
