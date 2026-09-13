// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import {
  BaseError, ContractFunctionRevertedError, createWalletClient, decodeEventLog, encodeAbiParameters,
  encodeFunctionData, getAddress, http, keccak256, toHex, zeroAddress, zeroHash,
  type Abi, type Address, type Hex, type TransactionReceipt,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  ALL_ROLES, createEnsClient, dnsEncodeName, ensNamehash, erc20Abi, factoryAbi, readEnsConfig,
  registrarAbi, registryAbi, resolverAbi, userRegistryAbi, type EnsConfig,
} from '../lib/ens'
import type { Fork } from './fork'

export type Scenario = 'new-app-ensv2' | 'add-to-existing'
const YEAR = 365n * 24n * 60n * 60n
const UINT64_MAX = (1n << 64n) - 1n
const MAX_USDC_COST = 100n * 10n ** 6n
type NameState = { status: number; expiry: bigint; latestOwner: Address; tokenId: bigint; resource: bigint }

/** On-chain registrar accepts age >= min and age < max. Leave one block for the reveal transaction. */
export function registrationRevealTimestamp(commitAt: bigint, minimumAge: bigint, maximumAge: bigint, now: bigint): bigint {
  assert(commitAt > 0n && minimumAge >= 0n && maximumAge > minimumAge, 'Invalid commitment window')
  assert(now >= commitAt, 'Current block precedes commitment')
  const earliest = commitAt + minimumAge
  const nextBlock = now + 1n
  const revealAt = earliest > nextBlock ? earliest : nextBlock
  assert(revealAt < commitAt + maximumAge && revealAt <= UINT64_MAX, 'Commitment expired or cannot fit another block')
  return revealAt
}

export function registrationBudget(base: bigint, premium: bigint, cap = MAX_USDC_COST): bigint {
  assert(base >= 0n && premium >= 0n && cap >= 0n, 'Registration quote cannot be negative')
  const total = base + premium
  assert(total <= cap, 'Registration price exceeds the explicit MockUSDC budget')
  return total
}

export function buildRegistrationInput(scenario: Scenario, entropy: Hex, owner: Address, resolver: Address, duration = YEAR) {
  assert(scenario === 'new-app-ensv2' || scenario === 'add-to-existing', 'Unknown ENS scenario')
  assert(/^0x(?:[0-9a-fA-F]{2}){16,32}$/.test(entropy), 'Use at least 128 bits of label entropy')
  assert(duration >= YEAR && duration <= 10n * YEAR, 'Registration duration must be one to ten years')
  assert(getAddress(owner) !== zeroAddress && getAddress(resolver) !== zeroAddress, 'Registration owner/resolver cannot be zero')
  const label = `${scenario === 'new-app-ensv2' ? 'tokyonew' : 'tokyoexisting'}-${entropy.slice(2, 34).toLowerCase()}`
  return { label, name: `${label}.eth`, childLabel: 'app', childName: `app.${label}.eth`, owner: getAddress(owner), resolver: getAddress(resolver), duration }
}

/** Evidence must identify the protocol's permission error; transport failures are never denials. */
export function assertPermissionRevert(error: unknown, actor: Address) {
  const cause = error instanceof BaseError ? error.walk(item => item instanceof ContractFunctionRevertedError) : error
  assert(cause instanceof ContractFunctionRevertedError, 'Expected a decoded on-chain permission revert')
  assert.equal(cause.data?.errorName, 'EACUnauthorizedAccountRoles', 'Unexpected contract revert')
  const args = cause.data?.args as readonly unknown[] | undefined
  assert(args?.length === 3 && typeof args[0] === 'bigint' && typeof args[1] === 'bigint' && args[1] > 0n && typeof args[2] === 'string', 'Malformed permission error')
  assert.equal(getAddress(args[2]), getAddress(actor), 'Revert identifies a different caller')
  return { errorName: 'EACUnauthorizedAccountRoles' as const, resource: args[0], roleBitmap: args[1], account: getAddress(args[2]) }
}

export function oneEvent<T>(receipt: Pick<TransactionReceipt, 'logs'>, emitter: Address, abi: Abi, eventName: string): T {
  const matches: T[] = []
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(emitter)) continue
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true })
      if (decoded.eventName === eventName) matches.push(decoded.args as T)
    } catch { /* Other events from the same official contract are not this event. */ }
  }
  assert.equal(matches.length, 1, `Expected exactly one ${eventName} from the verified emitter`)
  return matches[0]!
}

/** Minimal existing-app boundary: ENS records choose the recipient and decide whether a request runs. */
export function decideConfiguredAction(config: Pick<EnsConfig, 'recipient' | 'enabled' | 'limit'>, requestedUnits: number) {
  assert(Number.isSafeInteger(requestedUnits) && requestedUnits > 0, 'Request units must be a positive integer')
  assert(typeof config.enabled === 'boolean' && Number.isSafeInteger(config.limit) && config.limit >= 0, 'Configuration limit/enabled is invalid')
  const recipient = getAddress(config.recipient)
  assert.notEqual(recipient, zeroAddress, 'Configuration recipient cannot be zero')
  return { allowed: config.enabled && requestedUnits <= config.limit, recipient, requestedUnits, limit: config.limit }
}

export async function runScenario(fork: Fork, scenario: Scenario) {
  assert.equal(await fork.client.getChainId(), 11155111)
  const contracts = fork.config.contracts
  const registrar = getAddress(contracts.ETHRegistrar)
  const ethRegistry = getAddress(contracts.ETHRegistry)
  const factory = getAddress(contracts.VerifiableFactory)
  const usdc = getAddress(contracts.MockUSDC)
  const owner = fork.maker.account.address
  const delegateAccount = privateKeyToAccount(generatePrivateKey())
  await fork.rpc('anvil_setBalance', [delegateAccount.address, toHex(10n ** 18n)])
  const delegate = createWalletClient({ account: delegateAccount, chain: fork.chain, transport: http(fork.rpcUrl) })
  const proofs: Awaited<ReturnType<Fork['receipt']>>[] = []
  const denied: Record<string, unknown>[] = []
  const read = async <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []): Promise<T> =>
    await fork.client.readContract({ address, abi, functionName, args }) as T
  async function send(address: Address, abi: Abi, functionName: string, args: readonly unknown[], label: string, actor = fork.maker) {
    const hash = await actor.sendTransaction({ to: address, data: encodeFunctionData({ abi, functionName, args }) })
    const proof = await fork.receipt(hash, label)
    proofs.push(proof)
    return proof
  }
  async function proxy(implementation: Address, initialize: Hex, label: string) {
    const salt = BigInt(toHex(randomBytes(32)))
    const simulated = await fork.client.simulateContract({ address: factory, abi: factoryAbi, functionName: 'deployProxy', args: [implementation, salt, initialize], account: owner })
    const proof = await send(factory, factoryAbi, 'deployProxy', [implementation, salt, initialize], label)
    const event = oneEvent<{ sender: Address; proxyAddress: Address; implementation: Address; salt: bigint }>(proof.receipt, factory, factoryAbi, 'ProxyDeployed')
    assert.equal(getAddress(event.sender), owner)
    assert.equal(getAddress(event.implementation), implementation)
    assert.equal(event.salt, salt)
    assert.equal(getAddress(event.proxyAddress), getAddress(simulated.result as Address))
    assert.equal(getAddress(await read<Address>(factory, factoryAbi, 'verifyContract', [event.proxyAddress])), implementation)
    const runtime = await fork.client.getCode({ address: event.proxyAddress })
    assert(runtime && runtime !== '0x', 'Official-factory proxy has no runtime code')
    return { address: getAddress(event.proxyAddress), implementation, runtimeCodeHash: keccak256(runtime), transactionHash: proof.receipt.transactionHash }
  }

  const resolverProxy = await proxy(getAddress(contracts.PermissionedResolverImpl), encodeFunctionData({ abi: resolverAbi, functionName: 'initialize', args: [owner, ALL_ROLES, []] }), 'Deploy permissioned resolver through official factory')
  const registryProxy = await proxy(getAddress(contracts.UserRegistryImpl), encodeFunctionData({ abi: userRegistryAbi, functionName: 'initialize', args: [owner, ALL_ROLES] }), 'Deploy user registry through official factory')
  const resolver = resolverProxy.address
  const userRegistry = registryProxy.address
  const [minimumAge, maximumAge, minimumDuration] = await Promise.all([
    read<bigint>(registrar, registrarAbi, 'MIN_COMMITMENT_AGE'),
    read<bigint>(registrar, registrarAbi, 'MAX_COMMITMENT_AGE'),
    read<bigint>(registrar, registrarAbi, 'MIN_REGISTER_DURATION'),
  ])
  const registration = buildRegistrationInput(scenario, toHex(randomBytes(32)), owner, resolver, minimumDuration > YEAR ? minimumDuration : YEAR)
  assert.equal(await read<boolean>(registrar, registrarAbi, 'isAvailable', [registration.label]), true)
  assert.equal(getAddress(await read<Address>(registrar, registrarAbi, 'ETH_REGISTRY')), ethRegistry)
  assert.equal(getAddress(await read<Address>(registrar, registrarAbi, 'rentPriceOracle')), getAddress(contracts.StandardRentPriceOracle))
  assert.equal(await read<number>(usdc, erc20Abi, 'decimals'), 6, 'Budget is denominated in six-decimal official MockUSDC')
  const secret = toHex(randomBytes(32))
  const commitmentArgs = [registration.label, owner, secret, zeroAddress, resolver, registration.duration, zeroHash] as const
  const commitment = await read<Hex>(registrar, registrarAbi, 'makeCommitment', commitmentArgs)
  assert.equal(commitment, keccak256(encodeAbiParameters([
    { type: 'string' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes32' },
  ], commitmentArgs)), 'Local commitment differs from the official registrar')
  const commitmentProof = await send(registrar, registrarAbi, 'commit', [commitment], 'Commit random .eth registration')
  const committedAt = await read<bigint>(registrar, registrarAbi, 'commitmentAt', [commitment])
  assert.equal(committedAt, (await fork.client.getBlock({ blockNumber: commitmentProof.receipt.blockNumber })).timestamp)
  const revealAt = registrationRevealTimestamp(committedAt, minimumAge, maximumAge, (await fork.client.getBlock()).timestamp)
  await fork.rpc('evm_setNextBlockTimestamp', [Number(revealAt)])
  await fork.rpc('evm_mine')

  const [base, premium] = await read<readonly [bigint, bigint]>(registrar, registrarAbi, 'getRegisterPrice', [registration.label, registration.duration, usdc])
  const cost = registrationBudget(base, premium)
  const balanceBeforeMint = await read<bigint>(usdc, erc20Abi, 'balanceOf', [owner])
  await send(usdc, erc20Abi, 'mint', [owner, cost], 'Mint official Sepolia MockUSDC for registration')
  assert.equal(await read<bigint>(usdc, erc20Abi, 'balanceOf', [owner]), balanceBeforeMint + cost)
  await send(usdc, erc20Abi, 'approve', [registrar, cost], 'Approve exact registrar fee')
  assert.equal(await read<bigint>(usdc, erc20Abi, 'allowance', [owner, registrar]), cost)
  const beneficiary = getAddress(await read<Address>(registrar, registrarAbi, 'BENEFICIARY'))
  const recipientBefore = await read<bigint>(usdc, erc20Abi, 'balanceOf', [beneficiary])
  const latest = (await fork.client.getBlock()).timestamp
  registrationRevealTimestamp(committedAt, minimumAge, maximumAge, latest) // Fail before a reveal that cannot fit.
  const registrationProof = await send(registrar, registrarAbi, 'register', [...commitmentArgs.slice(0, 6), usdc, zeroHash], 'Reveal and pay official registrar')
  const registered = oneEvent<{ tokenId: bigint; label: string; owner: Address; subregistry: Address; resolver: Address; duration: bigint; paymentToken: Address; referrer: Hex; base: bigint; premium: bigint }>(registrationProof.receipt, registrar, registrarAbi, 'NameRegistered')
  assert.equal(registered.label, registration.label)
  assert.equal(getAddress(registered.owner), owner)
  assert.equal(getAddress(registered.resolver), resolver)
  assert.equal(getAddress(registered.subregistry), zeroAddress)
  assert.equal(getAddress(registered.paymentToken), usdc)
  assert.equal(registered.duration, registration.duration)
  assert.equal(registered.referrer, zeroHash)
  assert.equal(registered.base + registered.premium, cost)
  assert.equal(await read<bigint>(registrar, registrarAbi, 'commitmentAt', [commitment]), 0n)
  assert.equal(await read<bigint>(usdc, erc20Abi, 'balanceOf', [owner]), balanceBeforeMint)
  assert.equal(await read<bigint>(usdc, erc20Abi, 'balanceOf', [beneficiary]), recipientBefore + cost)
  assert.equal(await read<bigint>(usdc, erc20Abi, 'allowance', [owner, registrar]), 0n)

  // Resolve mutable token IDs immediately before writes; the initial label hash is not a permanent token ID.
  const parentTokenId = await read<bigint>(ethRegistry, registryAbi, 'findTokenId', [registration.label])
  assert.equal(parentTokenId, registered.tokenId)
  assert.equal(getAddress(await read<Address>(ethRegistry, registryAbi, 'ownerOf', [parentTokenId])), owner)
  await send(ethRegistry, registryAbi, 'setSubregistry', [parentTokenId, userRegistry], 'Link official .eth parent to user registry')
  await send(userRegistry, userRegistryAbi, 'setParent', [ethRegistry, registration.label], 'Set registry parent and label')
  assert.equal(getAddress(await read<Address>(ethRegistry, registryAbi, 'getSubregistry', [registration.label])), userRegistry)
  const [linkedParent, linkedLabel] = await read<readonly [Address, string]>(userRegistry, userRegistryAbi, 'getParent')
  assert.equal(getAddress(linkedParent), ethRegistry)
  assert.equal(linkedLabel, registration.label)
  const parentState = await read<NameState>(ethRegistry, registryAbi, 'getState', [await read<bigint>(ethRegistry, registryAbi, 'findTokenId', [registration.label])])
  const childExpiry = parentState.expiry - 1n
  await send(userRegistry, userRegistryAbi, 'register', [registration.childLabel, owner, zeroAddress, resolver, ALL_ROLES, childExpiry], 'Register controlled application subname')
  const childTokenId = await read<bigint>(userRegistry, userRegistryAbi, 'findTokenId', [registration.childLabel])
  const childState = await read<NameState>(userRegistry, userRegistryAbi, 'getState', [childTokenId])
  assert.equal(getAddress(childState.latestOwner), owner)
  assert.equal(childState.expiry, childExpiry)
  assert(childState.expiry <= parentState.expiry)
  assert.equal(getAddress(await read<Address>(userRegistry, userRegistryAbi, 'ownerOf', [childTokenId])), owner)
  assert.equal(getAddress(await read<Address>(userRegistry, userRegistryAbi, 'getResolver', [registration.childLabel])), resolver)

  const childNode = ensNamehash(registration.childName)
  const initialSetters = [
    encodeFunctionData({ abi: resolverAbi, functionName: 'setAddr', args: [ensNamehash(registration.name), owner] }),
    encodeFunctionData({ abi: resolverAbi, functionName: 'setAddr', args: [childNode, owner] }),
    ...Object.entries({ 'app:enabled': 'true', 'app:limit': '3', 'app:label': 'ENS-controlled starter' }).map(([key, value]) =>
      encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [childNode, key, value] })),
  ]
  await send(resolver, resolverAbi, 'multicall', [initialSetters], 'Set address and namespaced application records')
  const ensClient = createEnsClient(fork.rpcUrl)
  assert.equal(getAddress((await ensClient.getEnsAddress({ name: registration.name }))!), owner)
  assert.equal(getAddress((await ensClient.getEnsResolver({ name: registration.childName }))!), resolver)
  const before = await readEnsConfig(ensClient, registration.childName)

  await send(resolver, resolverAbi, 'authorizeTextRoles', [dnsEncodeName(registration.childName), 'app:limit', delegate.account.address, true], 'Grant delegate only the app:limit text key')
  const update = await send(resolver, resolverAbi, 'setText', [childNode, 'app:limit', '7'], 'Delegate updates only its authorized config key', delegate)
  const textEvent = oneEvent<{ node: Hex; key: string; value: string }>(update.receipt, resolver, resolverAbi, 'TextChanged')
  assert.equal(textEvent.node, childNode)
  assert.equal(textEvent.key, 'app:limit')
  assert.equal(textEvent.value, '7')

  async function deny(functionName: string, args: readonly unknown[], label: string) {
    let failure: unknown
    try { await fork.client.simulateContract({ address: resolver, abi: resolverAbi, functionName, args, account: delegate.account.address }) }
    catch (error) { failure = error }
    const permission = assertPermissionRevert(failure, delegate.account.address)
    const gas = 500_000n
    const hash = await delegate.sendTransaction({ to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName, args }), gas })
    const receipt = await fork.client.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'reverted', `${label} unexpectedly succeeded`)
    assert(receipt.gasUsed < gas, `${label} ran out of gas instead of rejecting permission`)
    denied.push({ label, simulationError: permission, transaction: await fork.client.getTransaction({ hash }), receipt })
  }
  await deny('setText', [childNode, 'app:enabled', 'false'], 'Delegate cannot modify a different text key')
  await deny('setAddr', [childNode, delegate.account.address], 'Delegate cannot redirect the address record')
  await send(resolver, resolverAbi, 'authorizeTextRoles', [dnsEncodeName(registration.childName), 'app:limit', delegate.account.address, false], 'Revoke scoped text delegation')
  await deny('setText', [childNode, 'app:limit', '9'], 'Revoked delegate cannot update its former key')
  const after = await readEnsConfig(ensClient, registration.childName)

  // The shared adapter supplies this exact behavioral boundary, independent of app presentation.
  assert.equal(getAddress(before.recipient), owner)
  assert.equal(getAddress(after.recipient), owner)
  assert.equal(getAddress(before.resolver), resolver)
  assert.equal(getAddress(after.resolver), resolver)
  assert.equal(before.enabled, true)
  assert.equal(after.enabled, true)
  assert.equal(before.limit, 3)
  assert.equal(after.limit, 7)
  const baseline = { recipient: owner, enabled: true, limit: 10 }
  const baselineDecision = decideConfiguredAction(baseline, 5)
  const decisionBefore = decideConfiguredAction(before, 5)
  const decisionAfter = decideConfiguredAction(after, 5)
  assert.equal(baselineDecision.allowed, true)
  assert.equal(decisionBefore.allowed, false)
  assert.equal(decisionAfter.allowed, true)
  assert.equal(decisionAfter.recipient, owner)

  const record = await fork.save(scenario, {
    status: 'PROVEN_ON_LOCAL_FORK', parentName: registration.name, name: registration.childName,
    owner, delegate: delegate.account.address, resolver: resolverProxy, userRegistry: registryProxy,
    registration: { commitment, committedAt, minimumAge, maximumAge, revealAt, duration: registration.duration, base, premium, cost, paymentToken: usdc, beneficiary, parentTokenId, childTokenId, parentState, childState },
    configuration: { before, after, baseline: scenario === 'add-to-existing' ? baseline : undefined, baselineDecision: scenario === 'add-to-existing' ? baselineDecision : undefined, decisionBefore, decisionAfter },
    permissions: { scope: `${registration.childName}:app:limit`, grantedThenRevoked: true, denied },
    transactions: proofs,
    proofLimits: ['Local Sepolia fork, not a public testnet deployment or live-demo URL', 'Existing-app baseline is a generic adapter example, not evidence of an existing product or Continuity eligibility', 'Only fork gas and block timestamps are synthetic; all token, registry and resolver writes use official contracts'],
  })
  console.log(`${scenario}: ${registration.childName}; registration transaction ${registrationProof.receipt.transactionHash}`)
  return record
}
