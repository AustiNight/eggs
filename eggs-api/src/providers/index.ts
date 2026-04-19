import type { Context } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

/**
 * Anthropic server-side tool definition. Accepts the versioned `type` identifier
 * (e.g. `web_search_20260209`, `web_fetch_20260209`) and any tool-specific options.
 */
export interface AnthropicTool {
  /** Server tools carry a versioned type identifier (e.g. 'web_search_20260209'). Omit for client (custom) tools. */
  type?: string
  name: string
  description?: string
  /** JSON Schema for client tool input. Required on custom tools, omitted on server tools. */
  input_schema?: Record<string, unknown>
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  /** Haiku requires ['direct'] — it doesn't support programmatic tool calling. */
  allowed_callers?: string[]
  [key: string]: unknown
}

/** A single URL the model cited from its web_search / web_fetch results. */
export interface Citation {
  url: string
  title?: string
  citedText?: string
}

/** A client-tool invocation made by the model (used for structured output). */
export interface ClientToolCall {
  id: string
  name: string
  input: unknown
}

export interface CompletionParams {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  jsonMode?: boolean
  /** Server-side tools (e.g. web_search, web_fetch) and/or client tools for structured output. */
  tools?: AnthropicTool[]
}

export interface CompletionResult {
  content: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
  /** URLs the model retrieved via web_search / web_fetch, when tools were enabled. */
  citations?: Citation[]
  /** Client-side tool calls the model made — used for structured output extraction. */
  toolCalls?: ClientToolCall[]
  /** The model's stop reason, e.g. 'tool_use' when a client tool was invoked. */
  stopReason?: string
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
