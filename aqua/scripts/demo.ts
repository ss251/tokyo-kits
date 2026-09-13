import { strict as assert } from 'node:assert'
import { encodeAbiParameters, decodeAbiParameters, erc20Abi, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem'
import { command, deploy, startFork, type Fork, type ForkWallet } from './fork'
import { buildPeggedOrder, buildExtructionOrder, buildCustomOpcodeOrder, encodeShipToApp, encodeDockFromApp, encodeQuote, encodeSwap } from './strategies'

const registryAbi = parseAbi([
  'function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)',
  'function dock(address app, bytes32 strategyHash, address[] tokens)',
])
const strategyType = parseAbiParameters('(address maker,address token0,address token1,uint16 feeBps,bytes32 salt)')
const quoteTypes = parseAbiParameters('uint256 amountIn,uint256 amountOut,bytes32 orderHash')
const unit = 10n ** 18n
type Evidence = Awaited<ReturnType<Fork['receipt']>>
type Call = { to: Address; data: Hex; value?: bigint }

async function send(fork: Fork, wallet: ForkWallet, call: Call, label: string, transactions: Evidence[]) {
  const hash = await wallet.sendTransaction(call)
  transactions.push(await fork.receipt(hash, label))
  console.log(`${label}: ${hash}`)
  return hash
}
async function approve(fork: Fork, wallet: ForkWallet, token: Address, spender: Address, amount: bigint, transactions: Evidence[]) {
  const hash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
  transactions.push(await fork.receipt(hash, 'approve fixture budget'))
}
async function balances(fork: Fork, token0: Address, token1: Address) {
  return {
    maker0: await fork.balance(token0, fork.maker.account.address), maker1: await fork.balance(token1, fork.maker.account.address),
    taker0: await fork.balance(token0, fork.taker.account.address), taker1: await fork.balance(token1, fork.taker.account.address),
  }
}
function assertSettlement(before: Awaited<ReturnType<typeof balances>>, after: Awaited<ReturnType<typeof balances>>, amountIn: bigint, amountOut: bigint, reverse = false) {
  if (!reverse) {
    assert.equal(before.maker1 - after.maker1, amountOut); assert.equal(after.maker0 - before.maker0, amountIn)
    assert.equal(after.taker1 - before.taker1, amountOut); assert.equal(before.taker0 - after.taker0, amountIn)
  } else {
    assert.equal(before.maker0 - after.maker0, amountOut); assert.equal(after.maker1 - before.maker1, amountIn)
    assert.equal(after.taker0 - before.taker0, amountOut); assert.equal(before.taker1 - after.taker1, amountIn)
  }
}

async function customApp(fork: Fork) {
  const transactions: Evidence[] = []
  const token0 = fork.config.token0 as Address, token1 = fork.config.token1 as Address
  const app = await deploy(fork, 'ConstantProductApp', [fork.official.aqua])
  const taker = await deploy(fork, 'CallbackTaker', [app.address])
  transactions.push(app.proof, taker.proof)
  const strategy = { maker: fork.maker.account.address, token0, token1, feeBps: 30, salt: keccak256(new TextEncoder().encode('tokyo-kits/app-open/v1')) }
  const data = encodeAbiParameters(strategyType, [strategy])
  const beforeShip = await balances(fork, token0, token1)
  const shipHash = await fork.maker.writeContract({ address: fork.official.aqua, abi: registryAbi, functionName: 'ship', args: [app.address, data, [token0, token1], [1000n * unit, 1000n * unit]] })
  transactions.push(await fork.receipt(shipHash, 'ship custom app strategy'))
  assert.deepEqual(await balances(fork, token0, token1), beforeShip, 'ship moved maker tokens')
  const fills = []
  for (const reverse of [false, true]) {
    const amountIn = unit
    const quote = await fork.client.readContract({ address: app.address, abi: app.abi, functionName: 'quoteExactIn', args: [strategy, !reverse, amountIn] }) as bigint
    assert(quote > 0n)
    await approve(fork, fork.taker, reverse ? token1 : token0, taker.address, amountIn, transactions)
    const before = await balances(fork, token0, token1)
    const args = [strategy, !reverse, amountIn, quote, fork.taker.account.address]
    const simulation = await fork.client.simulateContract({ account: fork.taker.account, address: taker.address, abi: taker.abi, functionName: 'swapExactIn', args })
    assert.equal(simulation.result, quote, 'quote != simulated swap')
    const hash = await fork.taker.writeContract(simulation.request)
    transactions.push(await fork.receipt(hash, `custom app fill ${reverse ? '1→0' : '0→1'}`))
    const after = await balances(fork, token0, token1)
    assertSettlement(before, after, amountIn, quote, reverse)
    console.log(`app-open fill: ${hash}`)
    fills.push({ reverse, amountIn, quote, hash, before, after })
  }
  const beforeDock = await balances(fork, token0, token1)
  const dockHash = await fork.maker.writeContract({ address: fork.official.aqua, abi: registryAbi, functionName: 'dock', args: [app.address, keccak256(data), [token0, token1]] })
  transactions.push(await fork.receipt(dockHash, 'dock custom app strategy'))
  assert.deepEqual(await balances(fork, token0, token1), beforeDock, 'dock moved maker tokens')
  await assert.rejects(fork.client.readContract({ address: app.address, abi: app.abi, functionName: 'quoteExactIn', args: [strategy, true, unit] }), 'docked strategy remained quotable')
  await fork.save('app-open', { contracts: { app: app.address, callbackTaker: taker.address }, shipHash, dockHash, assertions: ['ship and dock preserve custody', 'both directions quote == simulated swap == actual token deltas', 'docked strategy cannot quote'], fills, transactions })
}

async function routerOrder(fork: Fork, scenario: string, kind: 'pegged' | 'extruction' | 'custom') {
  const transactions: Evidence[] = []
  const token0 = fork.config.token0 as Address, token1 = fork.config.token1 as Address
  const chainId = fork.config.chainId as 137 | 8453
  let router = fork.official.router
  const contracts: Record<string, Address> = {}
  if (kind === 'custom') {
    const custom = await deploy(fork, 'CustomAquaRouter', [fork.official.aqua, token1, fork.maker.account.address])
    router = custom.address; contracts.customRouter = router; transactions.push(custom.proof)
    const registry = await fork.client.readContract({ address: router, abi: parseAbi(['function AQUA() view returns (address)']), functionName: 'AQUA' })
    assert.equal(registry.toLowerCase(), fork.official.aqua)
  }
  let order
  if (kind === 'pegged') {
    order = buildPeggedOrder(fork.maker.account.address, { address: token0, decimals: 18, reserve: 1000n * unit }, { address: token1, decimals: 18, reserve: 1000n * unit })
  } else if (kind === 'extruction') {
    const target = await deploy(fork, 'FixedRateExtruction', [router])
    contracts.extruction = target.address; transactions.push(target.proof)
    order = buildExtructionOrder(fork.maker.account.address, target.address, token0, token1, 2n, 1n)
  } else {
    order = buildCustomOpcodeOrder(fork.maker.account.address, token0, token1, 2n, 1n)
  }
  const beforeShip = await balances(fork, token0, token1)
  const allocations = [{ token: token0, amount: 1000n * unit }, { token: token1, amount: 1000n * unit }]
  const shipCall = encodeShipToApp(order, allocations, router, chainId)
  const shipHash = await send(fork, fork.maker, shipCall, `${kind} ship`, transactions)
  assert.deepEqual(await balances(fork, token0, token1), beforeShip, 'ship moved maker tokens')
  const fills = []
  for (const reverse of [false, true]) {
    const tokenIn = reverse ? token1 : token0, tokenOut = reverse ? token0 : token1
    const params = { order, tokenIn, tokenOut, amount: unit }
    const quoteCall = { ...encodeQuote(params, chainId), to: router }
    const quoted = await fork.client.call({ ...quoteCall, account: fork.taker.account })
    assert(quoted.data)
    const [amountIn, amountOut, orderHash] = decodeAbiParameters(quoteTypes, quoted.data)
    assert(amountOut > 0n); assert.equal(amountIn, unit); assert.equal(orderHash.toLowerCase(), order.hash().toString().toLowerCase())
    await approve(fork, fork.taker, tokenIn, router, amountIn, transactions)
    const swapCall = { ...encodeSwap({ ...params, threshold: amountOut, strictThreshold: true }, chainId), to: router }
    const simulated = await fork.client.call({ ...swapCall, account: fork.taker.account })
    assert(simulated.data)
    const swapAmounts = decodeAbiParameters(quoteTypes, simulated.data)
    assert.equal(swapAmounts[0], amountIn); assert.equal(swapAmounts[1], amountOut)
    const before = await balances(fork, token0, token1)
    const hash = await send(fork, fork.taker, swapCall, `${kind} fill ${reverse ? '1→0' : '0→1'}`, transactions)
    const after = await balances(fork, token0, token1)
    assertSettlement(before, after, amountIn, amountOut, reverse)
    fills.push({ reverse, amountIn, amountOut, orderHash, hash, before, after })
  }
  const beforeDock = await balances(fork, token0, token1)
  const dockHash = await send(fork, fork.maker, encodeDockFromApp(order, [token0, token1], router, chainId), `${kind} dock`, transactions)
  assert.deepEqual(await balances(fork, token0, token1), beforeDock)
  await fork.save(scenario, { implementation: kind, settlementRegistry: fork.official.aqua, executionRouter: router, usesOfficialRouter: router === fork.official.router, contracts, order: order.build(), shipHash, dockHash, assertions: ['ship and dock preserve maker custody', 'quote == simulated swap == actual deltas in both directions', 'Aqua settlement uses official registry'], fills, transactions })
}

const selected = process.argv[2] ?? 'all'
assert(['all', 'app-open', 'swapvm-opcode', 'continuity-recipe'].includes(selected), 'Unknown subfolder')
await command(['forge', 'build', '--threads', '1'])
const fork = await startFork()
try {
  console.log(`Fork ${fork.name}; official registry ${fork.official.aqua}; local execution chain 31337`)
  for (const token of [fork.config.token0, fork.config.token1] as Address[]) {
    assert.equal(await fork.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }), 18, 'Fixture assumes 18 decimals')
    await fork.fund(token, fork.maker.account.address, 10_000n * unit)
    await fork.fund(token, fork.taker.account.address, 10_000n * unit)
    const approval = await fork.maker.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [fork.official.aqua, 10_000n * unit] })
    await fork.receipt(approval, 'maker approves official Aqua fixture budget')
  }
  if (selected === 'all' || selected === 'app-open') await customApp(fork)
  if (selected === 'all' || selected === 'swapvm-opcode') {
    await routerOrder(fork, 'swapvm-opcode/official-extruction', 'extruction')
    await routerOrder(fork, 'swapvm-opcode', 'custom')
  }
  if (selected === 'all' || selected === 'continuity-recipe') await routerOrder(fork, 'continuity-recipe', 'pegged')
} finally { fork.stop() }
