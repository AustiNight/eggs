import type { ModelProvider, CompletionParams, CompletionResult } from './index.js'

export class OpenAIProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: params.maxTokens ?? 4096,
        response_format: params.jsonMode ? { type: 'json_object' } : undefined,
        messages: [
          { role: 'system', content: params.system },
          ...params.messages
        ]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${err}`)
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[]
      model: string
      usage: { prompt_tokens: number; completion_tokens: number }
    }

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens
      }
    }
  }
}
