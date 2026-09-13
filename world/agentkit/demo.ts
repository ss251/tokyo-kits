// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentBookVerifier, type AgentkitExtension, type AgentkitFetchEvent } from '@worldcoin/agentkit'
import { createPublicClient, getAddress, http, toHex, type PrivateKeyAccount } from 'viem'
import { worldchain } from 'viem/chains'
import { createRegisteredAgentClient, type AgentKitFetch } from './client'
import { createAgentKitService, type AgentKitAccess } from './service'
import { SQLiteAgentKitStore } from './storage'

const OFFICIAL_AGENT_BOOK = getAddress('0xA23aB2712eA7BBa896930544C7d6636a96b944dA')

/** Genuine SDK/HTTP/official-Book handshake. Caller records the resulting on-chain action separately. */
export async function runAgentKitHandshake({ rpcUrl, account }: { rpcUrl: string; account: PrivateKeyAccount }) {
  const chainClient = createPublicClient({ chain: worldchain, transport: http(rpcUrl) })
  if (await chainClient.getChainId() !== 480) throw new Error('NOT PROVEN: AgentBook requires chain 480')
  if (!await chainClient.getBytecode({ address: OFFICIAL_AGENT_BOOK })) throw new Error('NOT PROVEN: official AgentBook bytecode unavailable')
  const book = createAgentBookVerifier({ rpcUrl })
  const human = await book.lookupHuman(account.address)
  if (!human || BigInt(human) === 0n) throw new Error('NOT PROVEN: WORLD_AGENT_PRIVATE_KEY is not registered in official AgentBook, or lookup failed')

  // A separate durable file per proof run avoids changing the standalone service's lifetime quotas.
  const runDirectory = new URL('../.run/', import.meta.url)
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 })
  const directory = mkdtempSync(fileURLToPath(new URL('agentkit-demo-', runDirectory)))
  const storage = new SQLiteAgentKitStore(join(directory, 'agentkit.sqlite'))
  let service: ReturnType<typeof createAgentKitService> | undefined
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => service ? service.app.fetch(request) : new Response(null, { status: 503 }) })
  const events: AgentkitFetchEvent[] = []
  const statuses: number[] = []
  let challengeSha256: string | undefined
  let challengeNonce: string | undefined
  try {
    service = createAgentKitService({ origin: server.url.origin, storage, agentBook: book, rpcUrl })
    const transport: AgentKitFetch = async (input, init) => {
      const response = await fetch(input, init)
      statuses.push(response.status)
      if (response.status === 402) {
        const body = await response.clone().json() as { extensions: { agentkit: AgentkitExtension } }
        challengeSha256 = createHash('sha256').update(JSON.stringify(body.extensions.agentkit.info)).digest('hex')
        challengeNonce = body.extensions.agentkit.info.nonce
      }
      return response
    }
    const agent = createRegisteredAgentClient(account, transport, event => events.push(event))
    const response = await agent.fetch(service.resourceUri)
    if (response.status !== 200) throw new Error(`NOT PROVEN: AgentKit handshake returned HTTP ${response.status}`)
    const result = await response.json() as AgentKitAccess
    const humanId = toHex(BigInt(human))
    if (!result.ok || getAddress(result.agent) !== account.address || result.humanId !== humanId
      || result.usage.used !== 1 || statuses.join(',') !== '402,200' || !challengeSha256 || !challengeNonce
      || storage.challenge(challengeNonce)?.consumed !== true) {
      throw new Error('NOT PROVEN: AgentKit authenticated response did not match the signing agent and official Book')
    }
    return {
      agent: account.address, humanId, agentBook: OFFICIAL_AGENT_BOOK,
      http: { statuses, challengeSha256, used: result.usage.used, remaining: result.usage.remaining, nonceConsumed: true },
      sdk: { agentkit: '0.2.1', agentkitCore: '0.2.1' }, events,
    }
  } finally {
    server.stop(true)
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
