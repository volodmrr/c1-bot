import type { Env, ScrapedMessage } from './types'
import { channelPageUrl } from './channel'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export class RateLimitedError extends Error {
  constructor() {
    super('t.me returned 429')
    this.name = 'RateLimitedError'
  }
}

interface CurrentMessage {
  messageId: number
  postedAt: string
  parts: string[]
}

export async function extractMessages(html: string): Promise<ScrapedMessage[]> {
  const rendered: CurrentMessage[] = []
  let current: CurrentMessage | null = null

  const rewriter = new HTMLRewriter()
    .on('.tgme_widget_message[data-post]', {
      element(el) {
        if (current) rendered.push(current)
        const post = el.getAttribute('data-post') ?? ''
        current = { messageId: Number(post.split('/')[1]), postedAt: '', parts: [] }
      },
    })
    .on('.tgme_widget_message_text', {
      text(chunk) {
        current?.parts.push(chunk.text)
      },
    })
    .on('.tgme_widget_message_text br', {
      element() {
        current?.parts.push('\n')
      },
    })
    .on('.tgme_widget_message_meta time[datetime]', {
      element(el) {
        if (current && !current.postedAt) current.postedAt = el.getAttribute('datetime') ?? ''
      },
    })

  await rewriter.transform(new Response(html)).arrayBuffer()
  if (current) rendered.push(current)

  // KNOWN LIMITATION: a timestamp-less post below a processed higher id is skipped
  // forever (the watermark advances past it) — a silent, accepted archive hole.
  return rendered
    .filter((c) => Number.isFinite(c.messageId) && c.postedAt !== '')
    .map((c) => ({ messageId: c.messageId, postedAt: c.postedAt, rawText: c.parts.join('').trim() }))
}

export async function fetchChannel(env: Pick<Env, 'CHANNEL'>, afterId: number): Promise<ScrapedMessage[]> {
  // ?after=<id>: next page past the watermark, oldest-first; <=0 cold-starts to the newest page.
  const page = channelPageUrl(env)
  const url = afterId > 0 ? `${page}?after=${afterId}` : page
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  })

  if (response.status === 429) throw new RateLimitedError()
  if (!response.ok) throw new Error(`t.me returned ${response.status}`)

  return extractMessages(await response.text())
}
