import type {
  ModelProvider,
  CompletionParams,
  CompletionResult,
  Citation,
  ClientToolCall
} from './index.js'

// Anthropic content block shapes we care about when parsing responses.
type TextBlock = { type: 'text'; text: string }
type ClientToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
type ServerToolUseBlock = { type: 'server_tool_use'; id: string; name: string; input?: unknown }
type WebSearchResultBlock = {
  type: 'web_search_tool_result'
  tool_use_id: string
  content: Array<{
    type: 'web_search_result'
    url: string
    title?: string
    encrypted_content?: string
    page_age?: string
  }> | { type: 'web_search_tool_result_error'; error_code: string }
}
type WebFetchResultBlock = {
  type: 'web_fetch_tool_result'
  tool_use_id: string
  content: {
    type: 'web_fetch_result'
    url: string
    retrieved_at?: string
    content?: { type: 'document'; source: { type: 'text'; media_type: string; data: string } }
  }
}
type ContentBlock = TextBlock | ClientToolUseBlock | ServerToolUseBlock | WebSearchResultBlock | WebFetchResultBlock | Record<string, unknown>

interface AnthropicResponse {
  content: ContentBlock[]
  model: string
  stop_reason?: string
  usage: { input_tokens: number; output_tokens: number }
}

export class AnthropicProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: 'claude-haiku-4-5',
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages
    }

    // jsonMode prefill is incompatible with server tools — tool responses contain
    // multi-block content, and prefilling the assistant turn suppresses tool use.
    const useToolMode = Array.isArray(params.tools) && params.tools.length > 0
    if (useToolMode) {
      body.tools = params.tools
      if (params.toolChoice) body.tool_choice = params.toolChoice
    } else if (params.jsonMode) {
      body.messages = [
        ...params.messages,
        { role: 'assistant', content: '{' }
      ]
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[anthropic] API error status', response.status, 'body:', err.slice(0, 1000))
      throw new Error(`Anthropic API error ${response.status}: ${err}`)
    }

    const data = await response.json() as AnthropicResponse

    const { text, citations, toolCalls } = extractContent(data.content)
    let content = text
    // Only prepend '{' when we actually used prefill (no tools).
    if (!useToolMode && params.jsonMode) content = '{' + content

    return {
      content,
      model: data.model,
      stopReason: data.stop_reason,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens
      },
      citations: citations.length > 0 ? citations : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    }
  }
}

/**
 * Walk the content blocks: concatenate all text blocks, collect citations from
 * server-tool results, and collect client-tool calls the model made (for
 * structured output extraction).
 */
function extractContent(blocks: ContentBlock[]): {
  text: string
  citations: Citation[]
  toolCalls: ClientToolCall[]
} {
  const texts: string[] = []
  const citationMap = new Map<string, Citation>()
  const toolCalls: ClientToolCall[] = []

  for (const block of blocks) {
    const type = (block as { type?: string }).type
    if (type === 'text') {
      texts.push((block as TextBlock).text)
    } else if (type === 'tool_use') {
      const b = block as ClientToolUseBlock
      toolCalls.push({ id: b.id, name: b.name, input: b.input })
    } else if (type === 'web_search_tool_result') {
      const b = block as WebSearchResultBlock
      const content = b.content
      if (Array.isArray(content)) {
        for (const r of content) {
          if (r.type === 'web_search_result' && r.url) {
            if (!citationMap.has(r.url)) {
              citationMap.set(r.url, { url: r.url, title: r.title })
            }
          }
        }
      }
    } else if (type === 'web_fetch_tool_result') {
      const b = block as WebFetchResultBlock
      const r = b.content
      if (r && r.type === 'web_fetch_result' && r.url) {
        if (!citationMap.has(r.url)) {
          citationMap.set(r.url, { url: r.url })
        }
      }
    }
  }

  return {
    text: texts.join(''),
    citations: Array.from(citationMap.values()),
    toolCalls
  }
}
