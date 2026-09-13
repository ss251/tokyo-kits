import { strict as assert } from 'node:assert'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { getAddress, type Address } from 'viem'

export interface ProofBundle { wallet: Address; rpId: string; action: string; result: unknown }
export function parseProofBundle(value: unknown, expected: { rpId: string; action: string; environment: string }, now: bigint) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Proof bundle must be an object')
  const bundle = value as Record<string, unknown>
  assert.equal(bundle.rpId, expected.rpId); assert.equal(bundle.action, expected.action)
  assert(typeof bundle.wallet === 'string')
  const wallet = getAddress(bundle.wallet)
  assert(/^rp_[0-9a-fA-F]{1,16}$/.test(expected.rpId))
  const rpId = BigInt(`0x${expected.rpId.slice(3)}`); assert(rpId > 0n)
  const result = bundle.result as Record<string, unknown>
  assert(result && typeof result === 'object' && !Array.isArray(result))
  assert.equal(result.protocol_version, '4.0'); assert(!('session_id' in result))
  assert.equal(result.action, expected.action); assert.equal(result.environment, expected.environment)
  const uint = (input: unknown) => {
    assert(typeof input === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(input), 'Expected a uint256 hexadecimal value')
    return BigInt(input)
  }
  assert(Array.isArray(result.responses) && result.responses.length === 1)
  const credential = result.responses[0] as Record<string, unknown>
  assert(credential && typeof credential === 'object' && !Array.isArray(credential))
  assert.equal(credential.identifier, 'proof_of_human'); assert.equal(credential.issuer_schema_id, 1)
  assert.equal(uint(credential.signal_hash), BigInt(hashSignal(wallet)), 'World ID signal is bound to another wallet')
  assert(typeof credential.expires_at_min === 'number' && Number.isSafeInteger(credential.expires_at_min))
  const expiresAtMin = BigInt(credential.expires_at_min)
  assert(expiresAtMin >= now && expiresAtMin < 2n ** 64n, 'The credential lower-bound constraint has expired')
  assert(Array.isArray(credential.proof) && credential.proof.length === 5)
  const proof = credential.proof.map(uint) as [bigint, bigint, bigint, bigint, bigint]
  return { wallet, rpId, action: expected.action, environment: expected.environment, nullifier: uint(credential.nullifier), nonce: uint(result.nonce), expiresAtMin, proof }
}
