import type { Env, StoredMessage } from './types'
import { messageUrl } from './channel'
import { kyivDate } from './date'

const SYM: Record<string, string> = { USD: '$', UAH: '₴', USDT: '₮' }

// A → B means "give A, receive B". Receiving the base costs the sell price;
// giving the base gets you the buy price. Both directions on one monospace line,
// split by ·. USDT priced in USD needs 3dp; hryvnia pairs 2dp.
function pairLine(base: string, quote: string, buy: number, sell: number): string {
  const dp = quote === 'USD' ? 3 : 2
  const receive = `${SYM[quote]} → ${SYM[base]} ${sell.toFixed(dp)}`
  const give = `${SYM[base]} → ${SYM[quote]} ${buy.toFixed(dp)}`
  return `<code>${receive} · ${give}</code>`
}

function formatMessage(env: Env, m: StoredMessage): string {
  const lines: string[] = [`<code>${kyivDate(m.postedAt)}</code>`, '']
  if (m.status === 'parsed') {
    const usdUah = m.rates.find((r) => r.currency === 'USD' && r.quoteCurrency === 'UAH')
    const usdtUsd = m.rates.find((r) => r.currency === 'USDT' && r.quoteCurrency === 'USD')
    if (usdUah) lines.push(pairLine('USD', 'UAH', usdUah.buy, usdUah.sell))
    if (usdUah && usdtUsd) {
      lines.push(pairLine('USDT', 'UAH', usdUah.buy * usdtUsd.buy, usdUah.sell * usdtUsd.sell))
    }
    if (usdtUsd) lines.push(pairLine('USDT', 'USD', usdtUsd.buy, usdtUsd.sell))
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
