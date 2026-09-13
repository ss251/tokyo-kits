import { describe, expect, test } from 'bun:test'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { parseProofBundle } from '../scripts/proof'

const wallet = '0x0000000000000000000000000000000000001234'
const expected = { rpId: 'rp_00000000000000ab', action: 'tokyo-kits-verify', environment: 'staging' }
function fixture() {
  return { wallet, rpId: expected.rpId, action: expected.action, result: { protocol_version: '4.0', action: expected.action, environment: 'staging', nonce: '0x12', responses: [{ identifier: 'proof_of_human', issuer_schema_id: 1, signal_hash: hashSignal(wallet), expires_at_min: 1000, nullifier: '0x01', proof: ['0x0', '0x0', '0x0', '0x0', '0x0'] }] } }
}
describe('private proof bundle policy (parsing only; zero proof is never cryptographic evidence)', () => {
  test('maps the RP hexadecimal suffix, five words and packed-wallet signal', () => {
    const parsed = parseProofBundle(fixture(), expected, 999n)
    expect(parsed.rpId).toBe(171n); expect(parsed.proof).toHaveLength(5); expect(parsed.wallet.toLowerCase()).toBe(wallet)
  })
  test('refuses a proof bound to another caller', () => {
    const input = fixture(); input.wallet = '0x0000000000000000000000000000000000005678'
    expect(() => parseProofBundle(input, expected, 999n)).toThrow('another wallet')
  })
  test('refuses another environment or application action', () => {
    const input = fixture(); input.result.environment = 'production'
    expect(() => parseProofBundle(input, expected, 999n)).toThrow()
    expect(() => parseProofBundle(fixture(), { ...expected, action: 'other-action' }, 999n)).toThrow()
  })
  test('rejects expired credentials, legacy proofs, and malformed words', () => {
    expect(() => parseProofBundle(fixture(), expected, 1001n)).toThrow('expired')
    const legacy = fixture(); legacy.result.protocol_version = '3.0'
    expect(() => parseProofBundle(legacy, expected, 999n)).toThrow()
    const malformed = fixture(); malformed.result.responses[0]!.proof[0] = 'not-a-number'
    expect(() => parseProofBundle(malformed, expected, 999n)).toThrow('uint256')
  })
})
