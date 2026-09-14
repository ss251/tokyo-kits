// SPDX-License-Identifier: MIT
import { expect, test } from 'bun:test'
import { MultiBaasRequestError } from '../multibaas-basics/client'
import type { SdkReceipt } from '../multibaas-basics/validation'
import { waitForSdkReceipt } from '../scripts/rpc'
const hash = `0x${'aa'.repeat(32)}` as const
const receipt: SdkReceipt = { transactionHash: hash, blockHash: hash, blockNumber: 1n, status: 'success', contractAddress: null, logs: [] }
test('allows independent-node receipt lag and returns the later validated receipt', async () => {
  let calls = 0
  const actual = await waitForSdkReceipt({ getReceipt: async () => { if (++calls < 3) throw new MultiBaasRequestError('receipt', 404); return receipt } }, hash, { intervalMs: 1, timeoutMs: 100 })
  expect(actual).toBe(receipt); expect(calls).toBe(3)
})
test('receipt lag has a deadline and remains NOT PROVEN', async () => {
  await expect(waitForSdkReceipt({ getReceipt: async () => { throw new MultiBaasRequestError('receipt', 404) } }, hash, { intervalMs: 1, timeoutMs: 5 })).rejects.toThrow('NOT PROVEN')
})
test('does not retry authentication, transport, or receipt validation failures', async () => {
  for (const error of [new MultiBaasRequestError('receipt', 403), new MultiBaasRequestError('receipt'), new Error('Receipt transaction mismatch')]) {
    let calls = 0
    await expect(waitForSdkReceipt({ getReceipt: async () => { calls++; throw error } }, hash)).rejects.toBe(error)
    expect(calls).toBe(1)
  }
})
test('refuses unbounded receipt polling configuration before network access', async () => {
  let calls = 0
  await expect(waitForSdkReceipt({ getReceipt: async () => { calls++; return receipt } }, hash, { timeoutMs: 90_001 })).rejects.toThrow()
  expect(calls).toBe(0)
})
