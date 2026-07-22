import { fetchChannel, RateLimitedError } from './scrape'
import { AnthropicAuthError, TransientError, parseMessage } from './parse'
import { ConflictError, GitHubAuthError, getState, putRateFile, putState } from './github'
import { alert, notify } from './notify'
import { kyivDate } from './date'
import type { Env, ScrapedMessage, StoredMessage } from './types'

const BATCH_CAP = 20

const ANTHROPIC_AUTH_ALERT =
  'Anthropic rejected the API key — the bot stopped this run here.\n\n' +
  'The watermark was not advanced, so every message from this point retries next ' +
  'tick once the key works (anything already committed earlier in the batch is ' +
  're-committed identically).\n\n' +
  'Fix with: wrangler secret put ANTHROPIC_API_KEY'

const GITHUB_AUTH_ALERT =
  'GitHub rejected the token — likely expired. The bot cannot read or write state, ' +
  'so this run and every run after it fails until the token is replaced.\n\n' +
  'Fix with: wrangler secret put GITHUB_TOKEN'

export async function run(env: Env): Promise<void> {
  try {
    await runBatch(env)
  } catch (error) {
    if (error instanceof GitHubAuthError) await alert(env, GITHUB_AUTH_ALERT)
    throw error
  }
}

async function runBatch(env: Env): Promise<void> {
  const { lastId, lastParsedDate, sha } = await getState(env)

  // Once today's post is parsed, skip the whole run until the Kyiv date rolls over.
  if (lastParsedDate === kyivDate()) return

  let messages: ScrapedMessage[]
  try {
    messages = await fetchChannel(env, lastId)
  } catch (error) {
    if (error instanceof RateLimitedError) {
      console.log('rate limited by t.me, skipping this run')
      return
    }
    throw error
  }

  const fresh = messages
    .filter((m) => m.messageId > lastId)
    .sort((a, b) => a.messageId - b.messageId)
    .slice(0, BATCH_CAP)
  if (fresh.length === 0) return

  const processed: StoredMessage[] = []
  let newLastParsedDate = lastParsedDate

  for (const message of fresh) {
    let stored: StoredMessage
    try {
      const rates = await parseMessage(env, message.rawText)
      stored = {
        messageId: message.messageId,
        postedAt: message.postedAt,
        status: rates.length > 0 ? 'parsed' : 'empty',
        rates,
      }
    } catch (error) {
      if (error instanceof AnthropicAuthError) {
        await alert(env, ANTHROPIC_AUTH_ALERT)
        throw error
      }
      // Transient: stop here. Successes so far still commit; this id retries next tick.
      if (error instanceof TransientError) {
        console.log(`transient error at ${message.messageId}, stopping batch: ${error.message}`)
        break
      }
      const detail = error instanceof Error ? error.message : String(error)
      stored = { messageId: message.messageId, postedAt: message.postedAt, status: 'failed', rates: [], error: detail }
    }

    // Rate file first, then the watermark: a throw here just reprocesses idempotently.
    await putRateFile(env, stored)
    processed.push(stored)
    // Use the post's own Kyiv date, not now's, so a backlog post doesn't close the guard
    // on today's still-unseen message.
    if (stored.status === 'parsed') newLastParsedDate = kyivDate(message.postedAt)
  }

  if (processed.length === 0) return
  const newLastId = processed[processed.length - 1].messageId

  try {
    await putState(env, newLastId, newLastParsedDate, sha)
  } catch (error) {
    if (error instanceof ConflictError) {
      console.log('state.json changed under us, skipping the write')
      return
    }
    throw error
  }

  // The batch is already committed, so a notify failure only gets logged.
  try {
    await notify(env, processed)
  } catch (error) {
    console.error('owner notify failed (batch already committed):', error)
  }
}

export default {
  // Awaited, not ctx.waitUntil: waitUntil rejections count as successful invocations.
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await run(env)
  },
}
