import type { Env, StoredMessage } from './types'
import { messageUrl } from './channel'
import { kyivDate } from './date'

function formatMessage(env: Env, m: StoredMessage): string {
  const label = m.status === 'empty' ? 'Empty' : 'Failed'
  return `<code>${kyivDate(m.postedAt)}</code>\n\n${label} <a href="${messageUrl(env, m.messageId)}">${m.messageId}</a>`
}

async function send(env: Env, text: string, parseMode?: 'HTML'): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.OWNER_CHAT_ID,
      text,
      disable_web_page_preview: true,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`telegram sendMessage returned ${response.status}: ${await response.text()}`)
  }
}

// Empty/failed posts go to the owner as diagnostics; parsed ones need no attention.
export async function notify(env: Env, processed: StoredMessage[]): Promise<void> {
  const rest = processed.filter((m) => m.status !== 'parsed')
  if (rest.length === 0) return
  const sep = rest.length > 1 ? '\n\n———\n\n' : '\n\n'
  await send(env, rest.map((m) => formatMessage(env, m)).join(sep), 'HTML')
}

export async function alert(env: Env, text: string): Promise<void> {
  await send(env, text)
}
