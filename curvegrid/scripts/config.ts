// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
export const CHAIN_ID = 11155111 as const
export class NotProvenError extends Error {
  constructor(message: string) { super(`NOT PROVEN: ${message}`); this.name = 'NotProvenError' }
}
export function endpoint(value: string, allowLoopback = false) {
  const url = new URL(value)
  assert(url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)), 'Expected HTTPS endpoint or explicit local RPC')
  assert(!url.username && !url.password && !url.hash, 'Credentials/fragments must not be embedded in endpoint URLs')
  return url
}
export function loadConfig(component: 'all' | 'multibaas-basics' | 'events-webhooks') {
  assert(!Bun.env.CHAIN_ID || Bun.env.CHAIN_ID === String(CHAIN_ID), 'This starter only signs on Sepolia 11155111')
  const missing = ['MULTIBAAS_URL', 'MULTIBAAS_ADMIN_API_KEY', 'MULTIBAAS_API_KEY'].filter(name => !Bun.env[name])
  if (component !== 'multibaas-basics' && !Bun.env.MULTIBAAS_WEBHOOK_URL) missing.push('MULTIBAAS_WEBHOOK_URL')
  if (missing.length) throw new NotProvenError(`Missing ${missing.join(', ')}. Create a Sepolia MultiBaas deployment at https://console.curvegrid.com/ and separate admin/DApp User keys; webhooks additionally require a reachable HTTPS callback.`)
  const base = endpoint(Bun.env.MULTIBAAS_URL!)
  assert(base.pathname === '/' && !base.search, 'MULTIBAAS_URL must be the deployment origin without /api/v0')
  const callback = Bun.env.MULTIBAAS_WEBHOOK_URL ? endpoint(Bun.env.MULTIBAAS_WEBHOOK_URL) : undefined
  assert(!callback || (!callback.search && callback.pathname === '/webhook'), 'Webhook URL must end in /webhook without query parameters')
  const rpc = endpoint(Bun.env.CURVEGRID_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com', true)
  return { chainId: CHAIN_ID, baseUrl: base.origin, adminApiKey: Bun.env.MULTIBAAS_ADMIN_API_KEY!, dappApiKey: Bun.env.MULTIBAAS_API_KEY!, rpcUrl: rpc.toString(), webhookUrl: callback?.toString() }
}
