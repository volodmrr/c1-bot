import type { Currency, Env, ParsedRate, QuoteCurrency } from './types'

// Haiku suffices; the schema does the structural work (verified 42/42 vs Opus).
const MODEL = 'claude-haiku-4-5'

// fetch, not the SDK: its per-cold-start module-eval can trip the Worker CPU limit.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicMessage {
  stop_reason: string | null
  content: { type: string; text?: string }[]
}

// API key rejected: the run's problem, not the message's — don't mark messages 'failed'
// (that would permanently write off everything the bad key touched); retry next tick.
export class AnthropicAuthError extends Error {
  constructor(status: number) {
    super(`Anthropic rejected the API key (HTTP ${status})`)
    this.name = 'AnthropicAuthError'
  }
}

// Retriable (network/429/5xx): the run loop stops the batch and retries this id next tick.
export class TransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientError'
  }
}

export const RATE_SCHEMA = {
  type: 'object',
  properties: {
    rates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          currency: { type: 'string', enum: ['USD', 'USDT'] },
          quote_currency: { type: 'string', enum: ['UAH', 'USD'] },
          buy: { type: 'number' },
          sell: { type: 'number' },
        },
        required: ['currency', 'quote_currency', 'buy', 'sell'],
        additionalProperties: false,
      },
    },
  },
  required: ['rates'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You extract currency exchange rates from Telegram posts written in Ukrainian.

Each post is prose: a greeting, the day's rates, sometimes opening hours and a contact link. Extract only the USD and USDT rates; ignore any other currency.

Rules:
- USD is quoted in hryvnia. Set quote_currency to "UAH", buy to the rate at which the exchange BUYS dollars, and sell to the rate at which it SELLS.
- USDT is different. It is published as a percentage margin against the USD rate, e.g. "Купуємо usdt +0.4%" / "Продаємо usdt +0.7%". Express it as a multiplier with quote_currency "USD": +0.4% becomes buy 1.004, +0.7% becomes sell 1.007. Never convert USDT to a hryvnia figure yourself.
- If USD or USDT is not mentioned in the post, omit it. Do not guess, do not carry a value over from a previous day, and do not infer one currency's rate from another's.
- If the post contains no USD or USDT rates, return an empty array.`

export async function parseMessage(
  env: Pick<Env, 'ANTHROPIC_API_KEY'>,
  rawText: string,
): Promise<ParsedRate[]> {
  // Empty text → no rates; also avoids a 400 that would read as a parse failure.
  if (rawText.trim() === '') return []

  let httpResponse: Response
  try {
    httpResponse = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: RATE_SCHEMA } },
        messages: [{ role: 'user', content: rawText }],
      }),
    })
  } catch (error) {
    throw new TransientError(`Anthropic fetch failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (httpResponse.status === 401 || httpResponse.status === 403) {
    throw new AnthropicAuthError(httpResponse.status)
  }
  if (httpResponse.status === 429 || httpResponse.status >= 500) {
    throw new TransientError(`Anthropic returned ${httpResponse.status}`)
  }
  if (!httpResponse.ok) {
    throw new Error(`Anthropic returned ${httpResponse.status}: ${await httpResponse.text()}`)
  }

  const response = (await httpResponse.json()) as AnthropicMessage

  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.text === undefined) {
    throw new Error(`no text block in response (stop_reason: ${response.stop_reason})`)
  }

  const payload = JSON.parse(block.text) as {
    rates: { currency: string; quote_currency: string; buy: number; sell: number }[]
  }

  // Casts are safe: RATE_SCHEMA's enum guarantees the values.
  return payload.rates.map((row) => ({
    currency: row.currency as Currency,
    quoteCurrency: row.quote_currency as QuoteCurrency,
    buy: row.buy,
    sell: row.sell,
  }))
}
