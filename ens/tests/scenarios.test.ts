// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test'
import {
  ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, encodeEventTopics,
  getAddress, zeroAddress, zeroHash, type Address, type Hex, type TransactionReceipt,
} from 'viem'
import { factoryAbi, resolverAbi, normalizeEnsName } from '../lib/ens'
import {
  assertPermissionRevert, buildRegistrationInput, decideConfiguredAction, oneEvent,
  registrationBudget, registrationRevealTimestamp,
} from '../scripts/scenarios'

const owner = getAddress('0x0000000000000000000000000000000000000001')
const resolver = getAddress('0x0000000000000000000000000000000000000002')
const delegate = getAddress('0x0000000000000000000000000000000000000003')
const factory = getAddress('0x0000000000000000000000000000000000000004')
const implementation = getAddress('0x0000000000000000000000000000000000000005')
const entropy = `0x${'ab'.repeat(32)}` as Hex
const YEAR = 365n * 24n * 60n * 60n

describe('ENS scenario registration and execution policy', () => {
  test('reveal honors inclusive minimum age and exclusive maximum age', () => {
    expect(registrationRevealTimestamp(100n, 60n, 600n, 101n)).toBe(160n)
    expect(registrationRevealTimestamp(100n, 60n, 600n, 160n)).toBe(161n)
    expect(registrationRevealTimestamp(100n, 0n, 2n, 100n)).toBe(101n)
    expect(() => registrationRevealTimestamp(100n, 60n, 600n, 699n)).toThrow('cannot fit')
    expect(() => registrationRevealTimestamp(100n, 60n, 600n, 700n)).toThrow('expired')
    expect(() => registrationRevealTimestamp(100n, 60n, 60n, 100n)).toThrow('Invalid commitment window')
    expect(() => registrationRevealTimestamp(100n, 60n, 600n, 99n)).toThrow('precedes')
  })

  test('registration binds a bounded duration, nonzero owner/resolver, and independent names per subtrack', () => {
    const fresh = buildRegistrationInput('new-app-ensv2', entropy, owner, resolver)
    const existing = buildRegistrationInput('add-to-existing', entropy, owner, resolver)
    expect(fresh.name).not.toBe(existing.name)
    expect(normalizeEnsName(fresh.childName)).toBe(fresh.childName)
    expect(fresh.label.endsWith('ab'.repeat(16))).toBe(true)
    expect(fresh.owner).toBe(owner)
    expect(fresh.resolver).toBe(resolver)
    expect(fresh.duration).toBe(YEAR)
    expect(() => buildRegistrationInput('new-app-ensv2', '0x1234', owner, resolver)).toThrow('128 bits')
    expect(() => buildRegistrationInput('new-app-ensv2', entropy, zeroAddress, resolver)).toThrow('cannot be zero')
    expect(() => buildRegistrationInput('new-app-ensv2', entropy, owner, zeroAddress)).toThrow('cannot be zero')
    expect(() => buildRegistrationInput('new-app-ensv2', entropy, owner, resolver, 11n * YEAR)).toThrow('one to ten years')
  })

  test('exact payment budgets include premium and reject prices above the explicit cap', () => {
    expect(registrationBudget(5_000_000n, 1_000_000n)).toBe(6_000_000n)
    expect(registrationBudget(100_000_000n, 0n)).toBe(100_000_000n)
    expect(registrationBudget(0n, 0n)).toBe(0n)
    expect(() => registrationBudget(100_000_000n, 1n)).toThrow('budget')
    expect(() => registrationBudget(-1n, 0n)).toThrow('negative')
  })

  test('the existing configuration adapter changes behavior using live ENS limits', () => {
    const baseline = { recipient: owner, enabled: true, limit: 10 }
    expect(decideConfiguredAction(baseline, 5).allowed).toBe(true)
    expect(decideConfiguredAction({ ...baseline, limit: 3 }, 5).allowed).toBe(false)
    expect(decideConfiguredAction({ ...baseline, limit: 7 }, 5)).toMatchObject({ allowed: true, recipient: owner })
    expect(decideConfiguredAction({ ...baseline, enabled: false }, 5).allowed).toBe(false)
    expect(() => decideConfiguredAction(baseline, 0)).toThrow('positive integer')
    expect(() => decideConfiguredAction({ ...baseline, limit: NaN }, 5)).toThrow('Configuration')
    expect(() => decideConfiguredAction({ ...baseline, recipient: zeroAddress }, 5)).toThrow('cannot be zero')
  })
})

describe('ENS receipt evidence cannot substitute RPC failures or another emitter', () => {
  function permissionError(account: Address, errorName = 'EACUnauthorizedAccountRoles') {
    return new ContractFunctionRevertedError({
      abi: resolverAbi, functionName: 'setText',
      data: encodeErrorResult({ abi: resolverAbi, errorName, args: [17n, 16n, account] }),
    })
  }

  test('a denied operation must identify the expected delegate and permission error', () => {
    expect(assertPermissionRevert(permissionError(delegate), delegate)).toEqual({
      errorName: 'EACUnauthorizedAccountRoles', resource: 17n, roleBitmap: 16n, account: delegate,
    })
    expect(() => assertPermissionRevert(new Error('RPC timeout'), delegate)).toThrow('decoded on-chain')
    expect(() => assertPermissionRevert(undefined, delegate)).toThrow('decoded on-chain')
    expect(() => assertPermissionRevert(permissionError(owner), delegate)).toThrow('different caller')
    expect(() => assertPermissionRevert(permissionError(delegate, 'EACCannotGrantRoles'), delegate)).toThrow('Unexpected contract revert')
  })

  function deployedLog(emitter = factory): TransactionReceipt['logs'][number] {
    const topics = encodeEventTopics({ abi: factoryAbi, eventName: 'ProxyDeployed', args: { sender: owner, proxyAddress: resolver } })
    return {
      address: emitter, data: encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [123n, implementation]),
      topics: topics as [Hex, ...Hex[]], blockHash: zeroHash, blockNumber: 1n,
      transactionHash: zeroHash, transactionIndex: 0, logIndex: 0, removed: false,
    }
  }

  test('proxy provenance requires exactly one event from the official factory address', () => {
    const expected = { sender: owner, proxyAddress: resolver, salt: 123n, implementation }
    expect(oneEvent<typeof expected>({ logs: [deployedLog()] }, factory, factoryAbi, 'ProxyDeployed')).toEqual(expected)
    expect(oneEvent<typeof expected>({ logs: [deployedLog(), deployedLog(owner)] }, factory, factoryAbi, 'ProxyDeployed')).toEqual(expected)
    expect(() => oneEvent({ logs: [deployedLog(owner)] }, factory, factoryAbi, 'ProxyDeployed')).toThrow('exactly one')
    expect(() => oneEvent({ logs: [deployedLog(), deployedLog()] }, factory, factoryAbi, 'ProxyDeployed')).toThrow('exactly one')
  })
})
