import { strict as assert } from 'node:assert'
import { erc20Abi, parseAbi, type Address, type Hex } from 'viem'
import type { Fork } from './fork'

const factoryAbi = parseAbi(['function getPool(address tokenA,address tokenB,uint24 fee) view returns (address)'])
const quoterAbi = parseAbi(['struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }', 'function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'])
const routerAbi = parseAbi(['struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }', 'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)', 'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)'])

export async function runV3(fork: Fork, scenario = 'v3-or-v2') {
  const { config, client, taker } = fork
  const transactions: unknown[] = []
  const fills = []
  const token0 = config.weth as Address, token1 = config.usdc as Address
  const pool = await client.readContract({ address: config.v3Factory as Address, abi: factoryAbi, functionName: 'getPool', args: [token0, token1, 500] })
  assert.equal(pool.toLowerCase(), config.v3Pool.toLowerCase())
  await fork.fund(token0, taker.account.address, 10n ** 18n)
  for (const reverse of [false, true]) {
    const tokenIn = reverse ? token1 : token0, tokenOut = reverse ? token0 : token1
    const amountIn = reverse ? await fork.balance(token1, taker.account.address) / 2n : 10n ** 15n
    const quote = await client.simulateContract({ address: config.v3Quoter as Address, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn, tokenOut, amountIn, fee: 500, sqrtPriceLimitX96: 0n }] })
    const minimum = quote.result[0] * 99n / 100n
    assert(minimum > 0n)
    const approval = await taker.writeContract({ address: tokenIn, abi: erc20Abi, functionName: 'approve', args: [config.v3SwapRouter as Address, amountIn] })
    transactions.push(await fork.receipt(approval, 'approve exact v3 input'))
    const beforeIn = await fork.balance(tokenIn, taker.account.address), beforeOut = await fork.balance(tokenOut, taker.account.address)
    const simulated = await client.simulateContract({ account: taker.account, address: config.v3SwapRouter as Address, abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn, tokenOut, fee: 500, recipient: taker.account.address, amountIn, amountOutMinimum: minimum, sqrtPriceLimitX96: 0n }] })
    const hash = await taker.writeContract(simulated.request)
    const proof = await fork.receipt(hash, `v3 swap ${reverse ? 'USDC→WETH' : 'WETH→USDC'}`)
    transactions.push(proof)
    const actualIn = beforeIn - await fork.balance(tokenIn, taker.account.address), actualOut = await fork.balance(tokenOut, taker.account.address) - beforeOut
    assert.equal(actualIn, amountIn); assert.equal(actualOut, quote.result[0]); assert.equal(actualOut, simulated.result)
    console.log(`v3 swap: ${hash}`)
    fills.push({ reverse, tokenIn, tokenOut, amountIn, minimum, quote: quote.result, actualOut, hash })
  }
  await fork.save(scenario, { pool, router: config.v3SwapRouter, fills, assertions: ['official factory pool verified', 'both directions QuoterV2 == simulated swap == actual balance deltas', 'bounded approvals and positive minimum output'], transactions })
}
