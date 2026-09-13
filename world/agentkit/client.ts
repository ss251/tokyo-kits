// SPDX-License-Identifier: MIT
import { createAgentkitClient, type AgentkitFetchEvent } from '@worldcoin/agentkit'
import type { PrivateKeyAccount } from 'viem'
import { AGENTKIT_CHAIN, AGENTKIT_TTL_SECONDS } from './service'

/** Request dependency only; fixtures need not implement Bun's optional networking utilities. */
export type AgentKitFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** The upstream client signs 402 extension fields; bind them to this request before it sees them. */
async function guardChallenge(response: Response, requestedUrl: string): Promise<void> {
  if (response.status !== 402) return
  let body: unknown
  try { body = await response.clone().json() } catch { return }
  const extension = object(object(object(body)?.extensions)?.agentkit)
  if (!extension) return
  const info = object(extension.info)
  const expected = new URL(requestedUrl)
  if (!info || info.uri !== expected.href || info.domain !== expected.hostname
    || JSON.stringify(info.resources) !== JSON.stringify([expected.href])) {
    throw new Error('Rejected AgentKit challenge: scope differs from the requested resource')
  }
  const now = Date.now()
  const issuedAt = typeof info.issuedAt === 'string' ? Date.parse(info.issuedAt) : NaN
  const expiration = typeof info.expirationTime === 'string' ? Date.parse(info.expirationTime) : NaN
  const maxAge = AGENTKIT_TTL_SECONDS * 1000
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiration) || issuedAt > now || issuedAt < now - maxAge
    || expiration <= now || expiration > now + maxAge) {
    throw new Error('Rejected AgentKit challenge: expiration must be within 300 seconds')
  }
  const chains = extension.supportedChains
  const supported = Array.isArray(chains) && chains.length === 1 ? object(chains[0]) : undefined
  if (!supported || supported.chainId !== AGENTKIT_CHAIN || supported.type !== 'eip191' || supported.signatureScheme !== 'eip191') {
    throw new Error('Rejected AgentKit challenge: only World Chain EIP-191 is supported')
  }
}

export function createRegisteredAgentClient(account: PrivateKeyAccount, transport?: AgentKitFetch, onEvent?: (event: AgentkitFetchEvent) => void) {
  const fetchResource = transport ?? globalThis.fetch
  const guardedTransport: AgentKitFetch = async (input, init) => {
    // Never forward an authorization header through a redirect to another resource.
    const request = new Request(input, { ...init, redirect: 'error' })
    const response = await fetchResource(request)
    await guardChallenge(response, request.url)
    return response
  }
  const client = createAgentkitClient({
    signer: {
      address: account.address, chainId: AGENTKIT_CHAIN, type: 'eip191',
      signMessage: message => account.signMessage({ message }),
    },
    // Preserve Bun's native utility at the SDK boundary without requiring it of injected fetches.
    fetch: Object.assign(guardedTransport, { preconnect: globalThis.fetch.preconnect }), onEvent,
  })
  // Expose the request-bound flow only. The SDK's bare createHeader has no requested-URI context.
  return { fetch: client.fetch }
}
