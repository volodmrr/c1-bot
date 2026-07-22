export type Currency = 'USD' | 'USDT'
export type QuoteCurrency = 'UAH' | 'USD'

export type MessageStatus = 'parsed' | 'empty' | 'failed'

export interface ScrapedMessage {
  messageId: number
  postedAt: string // ISO 8601
  rawText: string
}

export interface ParsedRate {
  currency: Currency
  quoteCurrency: QuoteCurrency
  buy: number
  sell: number
}

export interface StoredMessage {
  messageId: number
  postedAt: string // ISO 8601
  status: MessageStatus
  rates: ParsedRate[]
  error?: string
}

export interface Env {
  CHANNEL: string
  ANTHROPIC_API_KEY: string
  TELEGRAM_BOT_TOKEN: string
  OWNER_CHAT_ID: string
  PUBLIC_CHAT_ID: string
  GITHUB_TOKEN: string
}
