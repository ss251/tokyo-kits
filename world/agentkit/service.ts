// SPDX-License-Identifier: MIT
import {
  AGENTKIT, agentkitResourceServerExtension, declareAgentkitExtension, formatSIWEMessage,
  parseAgentkitHeader, validateAgentkitMessage, verifyAgentkitSignature,
  type AgentBookVerifier, type AgentkitExtension, type AgentkitExtensionInfo, type AgentkitPayload,
} from '@worldcoin/agentkit'
import { Hono } from 'hono'
import { getAddress, recoverMessageAddress, toHex, type Address } from 'viem'
import { SQLiteAgentKitStore } from './storage'

export const AGENTKIT_CHAIN = 'eip155:480'
export const AGENTKIT_ENDPOINT = 'GET /data'
export const AGENTKIT_TTL_SECONDS = 300

export interface AgentKitServiceOptions {
  /** Fixed public origin; never infer the signing scope from an untrusted Host header. */
  origin: string
  storage: SQLiteAgentKitStore
  agentBook: AgentBookVerifier
  rpcUrl: string
  uses?: number
}
export interface AgentKitAccess {
  ok: true
  agent: Address
  humanId: `0x${string}`
  endpoint: string
  usage: { used: number; remaining: number }
}

function matchesIssuedInfo(payload: AgentkitPayload, info: AgentkitExtensionInfo): boolean {
  return payload.domain === info.domain && payload.uri === info.uri && payload.version === info.version
    && payload.nonce === info.nonce && payload.issuedAt === info.issuedAt
    && payload.expirationTime === info.expirationTime && payload.statement === info.statement
    && payload.notBefore === info.notBefore && payload.requestId === info.requestId
    && JSON.stringify(payload.resources) === JSON.stringify(info.resources)
}

export function createAgentKitService(options: AgentKitServiceOptions) {
  const parsedOrigin = new URL(options.origin)
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password
    || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('Expected an HTTP(S) origin')
  const origin = parsedOrigin.origin
  const resourceUri = `${origin}/data`
  const uses = options.uses ?? 3
  if (!Number.isSafeInteger(uses) || uses < 1) throw new Error('AgentKit quota must be a positive integer')
  const app = new Hono()

  async function issueChallenge(): Promise<AgentkitExtension> {
    const declaration = declareAgentkitExtension({
      domain: parsedOrigin.hostname, resourceUri, network: AGENTKIT_CHAIN,
      statement: 'Access this endpoint with a human-backed agent', expirationSeconds: AGENTKIT_TTL_SECONDS,
      mode: { type: 'free-trial', uses },
    })[AGENTKIT]
    const enrich = agentkitResourceServerExtension.enrichPaymentRequiredResponse
    if (!declaration || !enrich) throw new Error('Pinned AgentKit challenge builder is unavailable')
    const extension = await enrich(declaration, {
      requirements: [], resourceInfo: { url: resourceUri },
      paymentRequiredResponse: { x402Version: 2, resource: { url: resourceUri }, accepts: [] },
    }) as AgentkitExtension
    // This starter intentionally implements EOA authentication on World Chain only.
    extension.supportedChains = [{ chainId: AGENTKIT_CHAIN, type: 'eip191', signatureScheme: 'eip191' }]
    options.storage.issue(AGENTKIT_ENDPOINT, extension.info)
    return extension
  }

  app.get('/data', async c => {
    c.header('Cache-Control', 'no-store')
    if (new URL(c.req.url).href !== resourceUri) return c.json({ error: 'Resource URI mismatch' }, 400)
    const header = c.req.header(AGENTKIT)
    if (!header) return c.json({
      x402Version: 2, error: 'AgentKit registration required', resource: { url: resourceUri }, accepts: [],
      extensions: { [AGENTKIT]: await issueChallenge() },
    }, 402)
    if (header.length > 8192) return c.json({ error: 'AgentKit header is too large' }, 400)

    let payload: AgentkitPayload
    try { payload = parseAgentkitHeader(header) } catch { return c.json({ error: 'Malformed AgentKit header' }, 401) }
    if (payload.chainId !== AGENTKIT_CHAIN || payload.type !== 'eip191' || payload.signatureScheme !== 'eip191') {
      return c.json({ error: 'Only World Chain EIP-191 signatures are supported' }, 401)
    }
    if (payload.uri !== resourceUri || payload.domain !== parsedOrigin.hostname) {
      return c.json({ error: 'Signed resource URI mismatch' }, 401)
    }
    const challenge = options.storage.challenge(payload.nonce)
    if (!challenge || challenge.endpoint !== AGENTKIT_ENDPOINT || !matchesIssuedInfo(payload, challenge.info)) {
      return c.json({ error: 'Unknown or altered challenge' }, 401)
    }
    if (challenge.consumed) return c.json({ error: 'Challenge already consumed' }, 409)
    // The SDK checks host/time; exact URI, original fields and durable nonce consumption are above/below.
    const messageCheck = await validateAgentkitMessage(payload, resourceUri, { maxAge: AGENTKIT_TTL_SECONDS * 1000 })
    if (!messageCheck.valid) return c.json({ error: 'Expired or invalid AgentKit message' }, 401)

    let agent: Address
    try {
      agent = getAddress(payload.address)
      // Enforce this starter's EOA scope even though the official verifier also supports ERC-1271.
      const recovered = await recoverMessageAddress({
        message: formatSIWEMessage(payload, agent), signature: payload.signature as `0x${string}`,
      })
      if (getAddress(recovered) !== agent) return c.json({ error: 'Invalid EOA signature' }, 401)
    } catch { return c.json({ error: 'Invalid EOA signature' }, 401) }
    const signatureCheck = await verifyAgentkitSignature(payload, { rpcUrls: { [AGENTKIT_CHAIN]: options.rpcUrl } })
    if (!signatureCheck.valid || !signatureCheck.address || getAddress(signatureCheck.address) !== agent) {
      return c.json({ error: 'AgentKit signature verification failed' }, 401)
    }

    let humanId: `0x${string}`
    try {
      const human = await options.agentBook.lookupHuman(agent)
      if (!human || BigInt(human) <= 0n) return c.json({ error: 'Agent is not registered in AgentBook' }, 403)
      humanId = toHex(BigInt(human)) // Canonicalize IDs so alternate hex padding cannot split a quota.
    } catch { return c.json({ error: 'AgentBook lookup unavailable' }, 503) }
    const consumed = options.storage.consume(payload.nonce, AGENTKIT_ENDPOINT, humanId, uses)
    if (!consumed.ok) return c.json({ error: consumed.reason === 'quota' ? 'Human endpoint quota exhausted' : 'Challenge already consumed or expired' }, consumed.reason === 'quota' ? 429 : 409)
    return c.json({
      ok: true, agent, humanId, endpoint: AGENTKIT_ENDPOINT,
      usage: { used: consumed.used, remaining: consumed.remaining },
    } satisfies AgentKitAccess)
  })
  app.onError(() => new Response(JSON.stringify({ error: 'AgentKit service unavailable' }), {
    status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  }))
  return { app, issueChallenge, resourceUri }
}
