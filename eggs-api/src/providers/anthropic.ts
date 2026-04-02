import type { ModelProvider, CompletionParams, CompletionResult } from './index.js'

export class AnthropicProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: 'claude-haiku-4-5',
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages
    }

    if (params.jsonMode) {
      // Anthropic JSON mode via prefilling
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
      throw new Error(`Anthropic API error ${response.status}: ${err}`)
    }

    const data = await response.json() as {
      content: { text: string }[]
      model: string
      usage: { input_tokens: number; output_tokens: number }
    }

    let content = data.content[0].text
    if (params.jsonMode) content = '{' + content

    return {
      content,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens
      }
    }
  }
}
