import type { Env } from './types'

type ChannelEnv = Pick<Env, 'CHANNEL'>

export function channelPageUrl(env: ChannelEnv): string {
  return `https://t.me/s/${env.CHANNEL}`
}

export function messageUrl(env: ChannelEnv, messageId: number): string {
  return `https://t.me/${env.CHANNEL}/${messageId}`
}
