import type { Context } from 'hono'
import type { HonoEnv } from '../types/index.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAIProvider } from './openai.js'

export interface CompletionParams {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens?: number
  jsonMode?: boolean
}

export interface CompletionResult {
  content: string
  model: string
  usage: { inputTokens: number; outputTokens: number }
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
