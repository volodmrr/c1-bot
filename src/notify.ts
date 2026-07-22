import type { Env, ParsedRate, StoredMessage } from './types'
import { messageUrl } from './channel'
import { kyivDate } from './date'

function pair(rate: ParsedRate): string {
  return `${rate.currency}/${rate.quoteCurrency}`
}

function formatRate(rate: ParsedRate): string {
  // USDT is a USD multiplier (1.004 = +0.4%): needs 3dp or the margin rounds away; USD keeps 2.
  const dp = rate.currency === 'USDT' ? 3 : 2
  const buy = rate.buy.toFixed(dp)
  const sell = rate.sell.toFixed(dp)
  const shownSell = rate.quoteCurrency === 'UAH' ? `<b>${sell}</b>` : sell
  return `${pair(rate)} ${buy} / ${shownSell}`
}

function usdtInHryvnia(rates: ParsedRate[]): string | null {
  const usd = rates.find((r) => r.currency === 'USD' && r.quoteCurrency === 'UAH')
  const usdt = rates.find((r) => r.currency === 'USDT' && r.quoteCurrency === 'USD')
  if (!usd || !usdt) return null
  const buy = (usd.buy * usdt.buy).toFixed(2)
  const sell = (usd.sell * usdt.sell).toFixed(2)
  return `USDT/UAH ${buy} / <b>${sell}</b>`
}

function formatMessage(env: Env, m: StoredMessage): string {
  const lines: string[] = [kyivDate(m.postedAt), '']
  if (m.status === 'parsed') {
    for (const rate of m.rates) {
      if (rate.currency === 'USDT' && rate.quoteCurrency === 'USD') continue
      lines.push(formatRate(rate))
    }
    const uah = usdtInHryvnia(m.rates)
    if (uah) lines.push(uah)
  } else {
    const label = m.status === 'empty' ? 'Empty' : 'Failed'
    lines.push(`${label} <a href="${messageUrl(env, m.messageId)}">${m.messageId}</a>`)
  }
  return lines.join('\n')
}

export function formatRunReport(env: Env, processed: StoredMessage[]): string {
  const sep = processed.length > 1 ? '\n\n———\n\n' : '\n\n'
  return processed.map((m) => formatMessage(env, m)).join(sep)
}

async function send(env: Env, chatId: string, text: string, parseMode?: 'HTML'): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`telegram sendMessage returned ${response.status}: ${await response.text()}`)
  }
}

export async function notify(env: Env, processed: StoredMessage[]): Promise<void> {
  const parsed = processed.filter((m) => m.status === 'parsed')
  const rest = processed.filter((m) => m.status !== 'parsed')
  // Parsed rates go public; empty/failed stay with the owner as diagnostics.
  if (parsed.length > 0) await send(env, env.PUBLIC_CHAT_ID, formatRunReport(env, parsed), 'HTML')
  if (rest.length > 0) await send(env, env.OWNER_CHAT_ID, formatRunReport(env, rest), 'HTML')
}

export async function alert(env: Env, text: string): Promise<void> {
  await send(env, env.OWNER_CHAT_ID, text)
}
