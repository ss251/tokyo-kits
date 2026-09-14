// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import { createPublicClient, getAddress, http, keccak256, type Address, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { MultiBaasRequestError, type CounterArtifact, type MultiBaasAdapter } from '../multibaas-basics/client'
import { NotProvenError } from './config'
export function createRpc(url: string) {
  return createPublicClient({ chain: sepolia, transport: http(url, { batch: false, timeout: 15_000, retryCount: 1, fetchOptions: { headers: { 'User-Agent': 'tokyo-kits/0.1' } } }) })
}
export async function waitForSdkReceipt(mb: Pick<MultiBaasAdapter, 'getReceipt'>, hash: Hex, options: { timeoutMs?: number; intervalMs?: number } = {}) {
  const timeout = options.timeoutMs ?? 45_000; const interval = options.intervalMs ?? 1500
  assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 90_000)
  assert(Number.isSafeInteger(interval) && interval > 0 && interval <= 10_000)
  const deadline = Date.now() + timeout
  for (;;) {
    try { return await mb.getReceipt(hash) }
    catch (error) {
      if (!(error instanceof MultiBaasRequestError) || error.status !== 404) throw error
      if (Date.now() >= deadline) throw new NotProvenError('MultiBaas did not expose the independently confirmed transaction receipt within the bounded wait')
      await Bun.sleep(Math.min(interval, deadline - Date.now()))
    }
  }
}
export function maskImmutables(code: Hex, artifact: CounterArtifact) {
  const bytes = Buffer.from(code.slice(2), 'hex')
  const ranges = Object.values(artifact.immutableReferences ?? {}).flat()
  for (const { start, length } of ranges) {
    assert(Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length > 0 && start + length <= bytes.length, 'Invalid compiler immutable reference')
    bytes.fill(0, start, start + length)
  }
  return `0x${bytes.toString('hex')}` as Hex
}
export async function verifyRuntime(rpc: ReturnType<typeof createRpc>, address: Address, artifact: CounterArtifact, owner: Address) {
  const code = await rpc.getCode({ address })
  assert(code && code !== '0x', 'Published counter has no runtime code')
  assert.equal(maskImmutables(code, artifact), maskImmutables(artifact.deployedBytecode, artifact), 'Counter runtime differs from local compiler output')
  const actualOwner = await rpc.readContract({ address, abi: artifact.abi, functionName: 'owner' })
  assert(typeof actualOwner === 'string')
  assert.equal(getAddress(actualOwner), getAddress(owner), 'Immutable counter owner differs from signer')
  return { runtimeCodeHash: keccak256(code), maskedRuntimeCodeHash: keccak256(maskImmutables(code, artifact)), owner: getAddress(owner) }
}
