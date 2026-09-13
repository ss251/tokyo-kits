import { strict as assert } from 'node:assert'
import { Actions, URVersion, V4Planner } from '@uniswap/v4-sdk'
import { decodeEventLog, encodeAbiParameters, erc20Abi, getCreate2Address, parseAbi, toHex, type Address, type Hex } from 'viem'
import { deploy, type Fork } from './fork'
import { poolTuple, readPool, quoteV4, type PoolKey } from './read'

const managerAbi = parseAbi(['struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }', 'function initialize(PoolKey key,uint160 sqrtPriceX96) returns (int24 tick)'])
const positionAbi = parseAbi(['function modifyLiquidities(bytes unlockData,uint256 deadline) payable', 'function nextTokenId() view returns (uint256)', 'function ownerOf(uint256 tokenId) view returns (address)'])
const permitAbi = parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)'])
const routerAbi = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'])
const unit = 10n ** 18n

export function encodeV4Swap(key: PoolKey, zeroForOne: boolean, amount: bigint, minimum: bigint): Hex {
  assert(amount > 0n && minimum > 0n, 'Positive input and slippage minimum required')
  const planner = new V4Planner()
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey: key, zeroForOne, amountIn: amount.toString(), amountOutMinimum: minimum.toString(), minHopPriceX36: 0, hookData: '0x' }], URVersion.V2_1_1)
  planner.addAction(Actions.SETTLE_ALL, [zeroForOne ? key.currency0 : key.currency1, amount.toString()])
  planner.addAction(Actions.TAKE_ALL, [zeroForOne ? key.currency1 : key.currency0, minimum.toString()])
  return planner.finalize() as Hex
}

export async function runV4(fork: Fork, scenario = 'v4-hook') {
  const { client, maker, taker, config } = fork
  const transactions: unknown[] = []
  const confirm = async (hash: Hex, label: string) => { const proof = await fork.receipt(hash, label); transactions.push(proof); console.log(`${label}: ${hash}`); return proof }
  const factory = await deploy(fork, 'HookFactory')
  transactions.push(factory.proof)
  const constructor = [config.poolManager, 500, 3000]
  const initCodeHash = await client.readContract({ address: factory.address, abi: factory.abi, functionName: 'initCodeHash', args: constructor }) as Hex
  let salt = toHex(0n, { size: 32 }), hookAddress: Address | undefined
  for (let index = 0n; index < 2_000_000n; index++) {
    salt = toHex(index, { size: 32 })
    const candidate = getCreate2Address({ from: factory.address, salt, bytecodeHash: initCodeHash })
    if ((BigInt(candidate) & 0x3fffn) === 0x20c0n) { hookAddress = candidate; break }
    if (index % 2048n === 0n) await Bun.sleep(0)
  }
  assert(hookAddress, 'No hook salt found in bounded search')
  await confirm(await maker.writeContract({ address: factory.address, abi: factory.abi, functionName: 'deploy', args: [salt, ...constructor] }), 'CREATE2 deploy permission-mined hook')
  assert((await client.getCode({ address: hookAddress }))?.length! > 2)
  const key: PoolKey = { currency0: config.weth as Address, currency1: config.dai as Address, fee: 0x800000, tickSpacing: 60, hooks: hookAddress }
  assert(BigInt(key.currency0) < BigInt(key.currency1))
  const initHash = await maker.writeContract({ address: config.poolManager as Address, abi: managerAbi, functionName: 'initialize', args: [key, 1n << 96n] })
  await confirm(initHash, 'initialize dynamic-fee pool on official manager')
  const deadline = (await client.getBlock()).timestamp + 3600n
  for (const token of [key.currency0, key.currency1]) {
    await fork.fund(token, maker.account.address, 100n * unit)
    await fork.fund(token, taker.account.address, 10n * unit)
    await confirm(await maker.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [config.permit2 as Address, 5n * unit] }), 'maker approves bounded Permit2 budget')
    await confirm(await maker.writeContract({ address: config.permit2 as Address, abi: permitAbi, functionName: 'approve', args: [token, config.positionManager as Address, 5n * unit, Number(deadline)] }), 'Permit2 authorizes official PositionManager')
  }
  const tokenId = await client.readContract({ address: config.positionManager as Address, abi: positionAbi, functionName: 'nextTokenId' })
  const mintParams = encodeAbiParameters([poolTuple, { type: 'int24' }, { type: 'int24' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'bytes' }], [key, -600, 600, 100n * unit, 5n * unit, 5n * unit, maker.account.address, '0x'])
  const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [key.currency0, key.currency1])
  const unlockData = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], ['0x020d', [mintParams, settleParams]])
  await confirm(await maker.writeContract({ address: config.positionManager as Address, abi: positionAbi, functionName: 'modifyLiquidities', args: [unlockData, deadline] }), 'mint liquidity NFT through official PositionManager')
  assert.equal((await client.readContract({ address: config.positionManager as Address, abi: positionAbi, functionName: 'ownerOf', args: [tokenId] })).toLowerCase(), maker.account.address.toLowerCase())
  const initialState = await readPool(client, key)
  assert(initialState.liquidity > 0n)
  const artifact = await Bun.file(new URL('../out/DirectionalFeeHook.sol/DirectionalFeeHook.json', import.meta.url)).json()
  const fills = []
  for (const zeroForOne of [true, false]) {
    const tokenIn = zeroForOne ? key.currency0 : key.currency1, tokenOut = zeroForOne ? key.currency1 : key.currency0
    const amountIn = unit / 100n
    const quote = await quoteV4(client, key, zeroForOne, amountIn, taker.account.address)
    const minimum = quote.amountOut * 99n / 100n
    assert(minimum > 0n)
    await confirm(await taker.writeContract({ address: tokenIn, abi: erc20Abi, functionName: 'approve', args: [config.permit2 as Address, amountIn] }), 'taker approves exact input to Permit2')
    await confirm(await taker.writeContract({ address: config.permit2 as Address, abi: permitAbi, functionName: 'approve', args: [tokenIn, config.universalRouter as Address, amountIn, Number(deadline)] }), 'Permit2 authorizes Universal Router 2.1.1')
    const beforeIn = await fork.balance(tokenIn, taker.account.address), beforeOut = await fork.balance(tokenOut, taker.account.address)
    const commands = encodeV4Swap(key, zeroForOne, amountIn, minimum)
    const proof = await confirm(await taker.writeContract({ address: config.universalRouter as Address, abi: routerAbi, functionName: 'execute', args: ['0x10', [commands], deadline] }), `v4 swap ${zeroForOne ? '0→1' : '1→0'}`)
    const actualIn = beforeIn - await fork.balance(tokenIn, taker.account.address), actualOut = await fork.balance(tokenOut, taker.account.address) - beforeOut
    assert.equal(actualIn, amountIn); assert.equal(actualOut, quote.amountOut)
    const hookEvents = proof.receipt.logs.filter(log => log.address.toLowerCase() === hookAddress!.toLowerCase()).map(log => decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }))
    assert(hookEvents.some(event => event.eventName === 'SwapObserved'), 'afterSwap event missing')
    fills.push({ zeroForOne, quote, amountIn, minimum, actualOut, hash: proof.receipt.transactionHash, hookEvents })
  }
  await fork.save(scenario, { key, hookFactory: factory.address, hookAddress, create2Salt: salt, hookFlags: '0x20c0', initCodeHash, tokenId, initialState, finalState: await readPool(client, key), fills, assertions: ['CREATE2 address has exact enabled callback bits', 'NFT minted through official PositionManager', 'StateView slot0/liquidity/tick bitmap read', 'both V4Quoter directions equal actual UniversalRouter 2.1.1 output', 'Permit2 input budgets and positive output minimums', 'afterSwap event emitted'], transactions })
}
