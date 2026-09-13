// SPDX-License-Identifier: MIT
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createAgentBookVerifier } from '@worldcoin/agentkit'
import { createPublicClient, http } from 'viem'
import { worldchain } from 'viem/chains'
import { createAgentKitService } from './service'
import { SQLiteAgentKitStore } from './storage'

if (import.meta.main) {
  const rpcUrl = process.env.WORLD_RPC_URL ?? worldchain.rpcUrls.default.http[0]
  const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl) })
  if (await client.getChainId() !== 480) throw new Error('AgentBook lookup requires World Chain mainnet, chain 480')
  const port = Number(process.env.WORLD_AGENTKIT_PORT ?? 4021)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WORLD_AGENTKIT_PORT')
  const origin = process.env.WORLD_AGENTKIT_ORIGIN ?? `http://127.0.0.1:${port}`
  const dbPath = resolve(process.env.WORLD_AGENTKIT_DB ?? '.run/agentkit.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const storage = new SQLiteAgentKitStore(dbPath)
  const service = createAgentKitService({ origin, storage, agentBook: createAgentBookVerifier({ rpcUrl }), rpcUrl })
  const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: service.app.fetch })
  console.log(`AgentKit service: ${origin}/data (3 requests per human; persistent SQLite)`)
  const stop = () => { server.stop(true); storage.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
