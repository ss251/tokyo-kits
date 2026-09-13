// SPDX-License-Identifier: MIT
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentkitClient, parseAgentkitHeader, type AgentBookVerifier, type AgentkitExtension } from '@worldcoin/agentkit'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createRegisteredAgentClient, type AgentKitFetch } from '../agentkit/client'
import { AGENTKIT_ENDPOINT, createAgentKitService, type AgentKitAccess } from '../agentkit/service'
import { SQLiteAgentKitStore } from '../agentkit/storage'

const origin = 'http://127.0.0.1:4021'
// Generated throwaway EOA keys sign with the real SDK; no real human registration is asserted.
const alice = privateKeyToAccount(generatePrivateKey())
const bob = privateKeyToAccount(generatePrivateKey())
const stores = new Set<SQLiteAgentKitStore>()
const directories: string[] = []
let rpc: ReturnType<typeof Bun.serve>
let rpcUrl: string

beforeAll(() => {
  // UNIT RPC fixture: force the SDK/viem's real ECDSA-recovery fallback, without a public RPC.
  // This never reports an on-chain signature or an AgentBook registration as valid.
  rpc = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { id: number; method: string }
    return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted', data: '0x' } })
  } })
  rpcUrl = rpc.url.origin
})
afterAll(() => rpc.stop(true))
afterEach(() => {
  for (const storage of stores) storage.close()
  stores.clear()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function storageAt(path = ':memory:') {
  const storage = new SQLiteAgentKitStore(path)
  stores.add(storage)
  return storage
}
function fixture(options: { storage?: SQLiteAgentKitStore; book?: AgentBookVerifier; uses?: number } = {}) {
  const storage = options.storage ?? storageAt()
  // UNIT ONLY: both agent wallets intentionally resolve to the same mocked human.
  const book = options.book ?? { lookupHuman: async () => '0x1234' }
  const service = createAgentKitService({ origin, storage, agentBook: book, rpcUrl, uses: options.uses })
  return { ...service, storage }
}
type Service = ReturnType<typeof fixture>
const request = (service: Service, header: string) => service.app.request(service.resourceUri, { headers: { agentkit: header } })
// The low-level SDK is intentional here: rejection fixtures must be able to sign altered scope.
const sign = (extension: AgentkitExtension, account = alice) => createAgentkitClient({ signer: {
  address: account.address, chainId: 'eip155:480', type: 'eip191', signMessage: message => account.signMessage({ message }),
} }).createHeader(extension)
function changeEncodedHeader(header: string, patch: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ ...parseAgentkitHeader(header), ...patch })).toString('base64')
}

describe('AgentKit SDK signatures and durable per-human allowance (UNIT Book fixtures)', () => {
  test('real SDK client performs 402 challenge, EOA signature and authenticated retry', async () => {
    const service = fixture()
    const statuses: number[] = []
    const transport: AgentKitFetch = async (input, init) => {
      const response = await service.app.fetch(new Request(input, init))
      statuses.push(response.status)
      return response
    }
    const response = await createRegisteredAgentClient(alice, transport).fetch(service.resourceUri)
    expect(statuses).toEqual([402, 200])
    const body = await response.json() as AgentKitAccess
    expect(body).toMatchObject({ ok: true, agent: alice.address, humanId: '0x1234', usage: { used: 1, remaining: 2 } })
    expect(service.storage.usage(AGENTKIT_ENDPOINT, '0x1234')).toBe(1)
  })

  test('concurrent reuse of one valid signed nonce grants exactly one request', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    const header = await sign(challenge)
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(service, header)))
    expect(responses.filter(response => response.status === 200)).toHaveLength(1)
    expect(responses.filter(response => response.status === 409)).toHaveLength(7)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(true)
    expect(service.storage.usage(AGENTKIT_ENDPOINT, '0x1234')).toBe(1)
  })

  test('two different agents sharing a human cannot race the final quota slot across DB connections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tokyo-agentkit-test-'))
    directories.push(directory)
    const path = join(directory, 'shared.sqlite')
    const first = fixture({ storage: storageAt(path), uses: 1, book: { lookupHuman: async () => '0x0001' } })
    const second = fixture({ storage: storageAt(path), uses: 1, book: { lookupHuman: async () => '0x1' } })
    const a = await first.issueChallenge()
    const b = await second.issueChallenge()
    const headers = await Promise.all([sign(a, alice), sign(b, bob)])
    const responses = await Promise.all([request(first, headers[0]!), request(second, headers[1]!)])
    expect(responses.map(response => response.status).sort()).toEqual([200, 429])
    expect(first.storage.usage(AGENTKIT_ENDPOINT, '0x1')).toBe(1)
    expect(second.storage.challenge(a.info.nonce)?.consumed).toBe(true)
    expect(first.storage.challenge(b.info.nonce)?.consumed).toBe(true)
    expect((await request(first, headers[0]!)).status).toBe(409)
    expect((await request(second, headers[1]!)).status).toBe(409)
  })

  test('nonce and human quota survive closing and reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tokyo-agentkit-test-'))
    directories.push(directory)
    const path = join(directory, 'persistent.sqlite')
    const first = fixture({ storage: storageAt(path), uses: 1 })
    const header = await sign(await first.issueChallenge())
    expect((await request(first, header)).status).toBe(200)
    first.storage.close()
    stores.delete(first.storage)
    const reopened = fixture({ storage: storageAt(path), uses: 1 })
    expect((await request(reopened, header)).status).toBe(409)
    const another = await sign(await reopened.issueChallenge(), bob)
    expect((await request(reopened, another)).status).toBe(429)
  })

  test('forged signatures and copied headers cannot steal the signed agent identity or burn its nonce', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    const header = await sign(challenge)
    const forged = changeEncodedHeader(header, { address: bob.address })
    expect((await request(service, forged)).status).toBe(401)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(false)
    expect((await request(service, header)).status).toBe(200)
  })

  test('validly signed but unissued nonce or same-host alternate URI is rejected', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    const unknown = await sign({ ...challenge, info: { ...challenge.info, nonce: 'ab'.repeat(16) } })
    const otherPath = await sign({ ...challenge, info: { ...challenge.info, uri: `${origin}/other` } })
    expect((await request(service, unknown)).status).toBe(401)
    expect((await request(service, otherPath)).status).toBe(401)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(false)
  })

  test('scope-changing payload fields cannot bypass the issued challenge or EOA policy', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    const header = await sign(challenge)
    for (const patch of [
      { chainId: 'eip155:8453' }, { type: 'eip1271' }, { signatureScheme: 'eip6492' },
      { domain: 'evil.invalid' }, { resources: [`${origin}/other`] }, { expirationTime: undefined },
    ]) expect((await request(service, changeEncodedHeader(header, patch))).status).toBe(401)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(false)
  })

  test('expired issued challenges and query-bearing request URLs cannot grant access', async () => {
    const service = fixture()
    const original = await service.issueChallenge()
    const expired: AgentkitExtension = { ...original, info: {
      ...original.info, nonce: 'cd'.repeat(16),
      issuedAt: new Date(Date.now() - 360_000).toISOString(), expirationTime: new Date(Date.now() - 1_000).toISOString(),
    } }
    service.storage.issue(AGENTKIT_ENDPOINT, expired.info)
    expect((await request(service, await sign(expired))).status).toBe(401)
    const header = await sign(original)
    expect((await service.app.request(`${service.resourceUri}?alternate=true`, { headers: { agentkit: header } })).status).toBe(400)
    expect(service.storage.usage(AGENTKIT_ENDPOINT, '0x1234')).toBe(0)
  })

  test('unregistered agents fail closed after real signature verification', async () => {
    let lookups = 0
    const service = fixture({ book: { lookupHuman: async () => { lookups++; return null } } })
    const challenge = await service.issueChallenge()
    expect((await request(service, await sign(challenge))).status).toBe(403)
    expect(lookups).toBe(1)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(false)
    expect(service.storage.usage(AGENTKIT_ENDPOINT, '0x1234')).toBe(0)
  })

  test('malformed headers are rejected before any Book lookup', async () => {
    let lookups = 0
    const service = fixture({ book: { lookupHuman: async () => { lookups++; return '0x1234' } } })
    expect((await request(service, 'invalid!')).status).toBe(401)
    expect((await request(service, 'a'.repeat(8193))).status).toBe(400)
    expect(lookups).toBe(0)
  })

  test('client never invokes its signer for a challenge scoped to a different resource', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    let signatures = 0
    const account = { ...alice, signMessage: async (...args: Parameters<typeof alice.signMessage>) => {
      signatures++; return alice.signMessage(...args)
    } }
    for (const info of [
      { ...challenge.info, uri: `${origin}/another-resource`, resources: [`${origin}/another-resource`] },
      { ...challenge.info, domain: 'other.invalid' },
    ]) {
      const transport: AgentKitFetch = async () => Response.json({ extensions: { agentkit: { ...challenge, info } } }, { status: 402 })
      await expect(createRegisteredAgentClient(account, transport).fetch(service.resourceUri)).rejects.toThrow('scope differs')
    }
    expect(signatures).toBe(0)
  })

  test('client never invokes its signer for excessive TTL or an unsupported signing policy', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    let signatures = 0
    const account = { ...alice, signMessage: async (...args: Parameters<typeof alice.signMessage>) => {
      signatures++; return alice.signMessage(...args)
    } }
    const excessive = { ...challenge, info: { ...challenge.info, expirationTime: new Date(Date.now() + 600_000).toISOString() } }
    const badChain = { ...challenge, supportedChains: [{ chainId: 'eip155:8453', type: 'eip191', signatureScheme: 'eip191' }] }
    for (const extension of [excessive, badChain]) {
      const transport: AgentKitFetch = async () => Response.json({ extensions: { agentkit: extension } }, { status: 402 })
      await expect(createRegisteredAgentClient(account, transport).fetch(service.resourceUri)).rejects.toThrow('Rejected AgentKit challenge')
    }
    expect(signatures).toBe(0)
  })

  test('persisted challenges cannot be replayed after a same-host origin scheme change', async () => {
    const service = fixture()
    const challenge = await service.issueChallenge()
    const header = await sign(challenge)
    const migrated = createAgentKitService({
      origin: origin.replace('http:', 'https:'), storage: service.storage,
      rpcUrl, agentBook: { lookupHuman: async () => '0x1234' },
    })
    expect((await migrated.app.request(migrated.resourceUri, { headers: { agentkit: header } })).status).toBe(401)
    expect(service.storage.challenge(challenge.info.nonce)?.consumed).toBe(false)
  })
})
