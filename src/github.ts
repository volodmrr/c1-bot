import type { Env, StoredMessage } from './types'

const OWNER = 'volodmrr'
const REPO = 'c1-bot'
const BRANCH = 'main'
const API = 'https://api.github.com'
const STATE_PATH = 'data/state.json'
const ratePath = (id: number): string => `data/rates/${id}.json`
const UA = 'currency-bot'

export class ConflictError extends Error {
  constructor() {
    super('state.json changed under us')
    this.name = 'ConflictError'
  }
}

// 401 = expired/revoked token: the run's problem, not the message's. Bubble up so the
// loop stops and alerts instead of writing anything off. (403 is rate-limit, not auth.)
export class GitHubAuthError extends Error {
  constructor(status: number) {
    super(`GitHub rejected the token (HTTP ${status}) — likely expired`)
    this.name = 'GitHubAuthError'
  }
}

function assertNotExpired(status: number): void {
  if (status === 401) throw new GitHubAuthError(status)
}

function headers(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
    'Content-Type': 'application/json',
  }
}

// workerd btoa/atob are Latin1-only; round-trip via TextEncoder/TextDecoder for UTF-8.
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export interface State {
  lastId: number
  // Kyiv date of the last message parsed with rates; '' if none.
  lastParsedDate: string
  sha: string
}

export async function getState(env: Env): Promise<State> {
  const response = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${STATE_PATH}?ref=${BRANCH}`, {
    headers: headers(env),
  })
  if (!response.ok) {
    assertNotExpired(response.status)
    throw new Error(`GitHub GET ${STATE_PATH} returned ${response.status}: ${await response.text()}`)
  }
  const body = (await response.json()) as { content: string; sha: string }
  const parsed = JSON.parse(fromBase64(body.content)) as { lastId: number; lastParsedDate?: string }
  return { lastId: parsed.lastId, lastParsedDate: parsed.lastParsedDate ?? '', sha: body.sha }
}

export async function putState(env: Env, lastId: number, lastParsedDate: string, sha: string): Promise<void> {
  const response = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${STATE_PATH}`, {
    method: 'PUT',
    headers: headers(env),
    body: JSON.stringify({
      message: `state: lastId ${lastId}`,
      content: toBase64(JSON.stringify({ lastId, lastParsedDate }, null, 2) + '\n'),
      sha,
      branch: BRANCH,
    }),
  })
  if (response.status === 409) throw new ConflictError()
  if (!response.ok) {
    assertNotExpired(response.status)
    throw new Error(`GitHub PUT ${STATE_PATH} returned ${response.status}: ${await response.text()}`)
  }
}

export async function putRateFile(env: Env, message: StoredMessage): Promise<void> {
  const path = ratePath(message.messageId)
  const content = toBase64(JSON.stringify(message, null, 2) + '\n')
  const commit = commitMessage(message)

  let response = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: headers(env),
    body: JSON.stringify({ message: commit, content, branch: BRANCH }),
  })

  // 422 = file already exists (reprocessed tick): fetch its sha and overwrite.
  if (response.status === 422) {
    const existing = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`, {
      headers: headers(env),
    })
    if (!existing.ok) {
      assertNotExpired(existing.status)
      throw new Error(`GitHub GET ${path} (for sha) returned ${existing.status}`)
    }
    const sha = ((await existing.json()) as { sha: string }).sha
    response = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: headers(env),
      body: JSON.stringify({ message: commit, content, sha, branch: BRANCH }),
    })
  }

  if (!response.ok) {
    assertNotExpired(response.status)
    throw new Error(`GitHub PUT ${path} returned ${response.status}: ${await response.text()}`)
  }
}

function commitMessage(m: StoredMessage): string {
  if (m.status === 'failed') return `rates: ${m.messageId} failed`
  if (m.status === 'empty') return `rates: ${m.messageId} (no rates)`
  const summary = m.rates.map((r) => `${r.currency}/${r.quoteCurrency}`).join(' ')
  return `rates: ${m.messageId} ${summary}`
}
