import { strict as assert } from 'node:assert'
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem'

// Official v3-periphery INonfungiblePositionManager and IMulticall interfaces.
export const nfpmExecutionAbi = parseAbi([
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256,uint128,uint256,uint256)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint128,uint256,uint256)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256,uint256)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256,uint256)',
])

export interface LpExecutionContext {
  kind: 'create' | 'increase' | 'decrease'
  owner: Address
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  tokenId: bigint
  liquidityAtQuote: bigint
  decreasePercentage?: number
  independentToken?: { tokenAddress: Address; amount: string }
  quoteAmounts: readonly [bigint, bigint]
  slippagePercent: number
  now: bigint
}

export function validateLpCalldata(data: Hex, context: LpExecutionContext) {
  const same = (actual: Address, expected: Address, label: string) => assert.equal(actual.toLowerCase(), expected.toLowerCase(), label)
  const bps = Math.round(context.slippagePercent * 100)
  assert(Number.isSafeInteger(bps) && bps > 0 && bps <= 100, 'LP example slippage must be positive and at most 1%')
  assert(context.quoteAmounts.every(amount => amount >= 0n), 'Negative LP quote')
  const minima = context.quoteAmounts.map(amount => amount * BigInt(10_000 - bps) / 10_000n)
  const limits = context.quoteAmounts.map(amount => (amount * BigInt(10_000 + bps) + 9_999n) / 10_000n)
  if (context.kind !== 'decrease') {
    assert(context.independentToken, 'Missing requested independent-token budget')
    const index = [context.token0, context.token1].findIndex(token => token.toLowerCase() === context.independentToken!.tokenAddress.toLowerCase())
    assert(index >= 0, 'Independent token not in pair')
    const requested = BigInt(context.independentToken.amount)
    assert(requested > 0n && context.quoteAmounts[index]! <= requested, 'API quote exceeds independent-token request')
    limits[index] = limits[index]! < requested ? limits[index]! : requested
  }
  let actions = 0, collects = 0, calls = 0, liquidityRemoved = 0n
  let desired: readonly [bigint, bigint] = [0n, 0n]
  let actionMinima: readonly [bigint, bigint] = [0n, 0n]
  const checkAmounts = (amount0: bigint, amount1: bigint, minimum0: bigint, minimum1: bigint) => {
    const amounts = [amount0, amount1], minimums = [minimum0, minimum1]
    for (let i = 0; i < 2; i++) {
      assert(amounts[i]! <= limits[i]!, 'LP calldata desired amount exceeds bounded quote/request')
      assert(minimums[i]! >= minima[i]! && minimums[i]! <= amounts[i]!, 'LP calldata weakens slippage minimum')
    }
    assert(amount0 > 0n || amount1 > 0n, 'LP deposit is empty')
    desired = [amount0, amount1]
    actionMinima = [minimum0, minimum1]
  }
  function walk(call: Hex, depth: number) {
    assert(depth <= 4 && ++calls <= 16, 'LP multicall nesting/count exceeds bounded example')
    let decoded: ReturnType<typeof decodeFunctionData<typeof nfpmExecutionAbi>>
    try { decoded = decodeFunctionData({ abi: nfpmExecutionAbi, data: call }) }
    catch { throw new Error('Unsupported NFPM selector; refusing to guess API transaction behavior') }
    if (decoded.functionName === 'multicall') {
      assert(decoded.args[0].length > 0, 'Empty LP multicall')
      for (const nested of decoded.args[0]) walk(nested, depth + 1)
      return
    }
    if (decoded.functionName === 'collect') {
      const params = decoded.args[0]
      assert(context.kind === 'decrease' && actions === 1 && ++collects === 1, 'Collect must follow the sole decrease')
      assert.equal(params.tokenId, context.tokenId, 'Collect targets another public NFT')
      same(params.recipient, context.owner, 'Collect recipient differs from owner')
      assert(params.amount0Max >= actionMinima[0] && params.amount1Max >= actionMinima[1], 'Collect cannot satisfy withdrawal minimums')
      return
    }
    assert(++actions === 1, 'Exactly one LP mutation is allowed')
    const params = decoded.args[0]
    assert(params.deadline > context.now && params.deadline <= context.now + 86400n, 'LP deadline is expired or unbounded')
    if (decoded.functionName === 'mint') {
      const params = decoded.args[0]
      assert.equal(context.kind, 'create', 'Unexpected mint action')
      same(params.token0, context.token0, 'Mint token0 mismatch'); same(params.token1, context.token1, 'Mint token1 mismatch')
      same(params.recipient, context.owner, 'Mint recipient differs from owner')
      assert.equal(params.fee, context.fee, 'Mint pool fee mismatch')
      assert.equal(params.tickLower, context.tickLower, 'Mint lower tick mismatch'); assert.equal(params.tickUpper, context.tickUpper, 'Mint upper tick mismatch')
      checkAmounts(params.amount0Desired, params.amount1Desired, params.amount0Min, params.amount1Min)
    } else if (decoded.functionName === 'increaseLiquidity') {
      const params = decoded.args[0]
      assert.equal(context.kind, 'increase', 'Unexpected increase action')
      assert.equal(params.tokenId, context.tokenId, 'Increase targets another public NFT')
      checkAmounts(params.amount0Desired, params.amount1Desired, params.amount0Min, params.amount1Min)
    } else {
      const params = decoded.args[0]
      assert.equal(context.kind, 'decrease', 'Unexpected decrease action')
      assert.equal(params.tokenId, context.tokenId, 'Decrease targets another public NFT')
      const percentage = context.decreasePercentage
      assert(percentage !== undefined && Number.isInteger(percentage) && percentage >= 1 && percentage <= 100)
      const expected = context.liquidityAtQuote * BigInt(percentage)
      assert(params.liquidity > 0n && params.liquidity >= expected / 100n && params.liquidity <= (expected + 99n) / 100n, 'Decrease exceeds requested public-position percentage')
      assert(params.amount0Min >= minima[0]! && params.amount1Min >= minima[1]!, 'Decrease weakens quoted withdrawal minimum')
      liquidityRemoved = params.liquidity
      actionMinima = [params.amount0Min, params.amount1Min]
    }
  }
  walk(data, 0)
  assert(actions === 1 && (context.kind !== 'decrease' || collects === 1), 'Missing requested LP action or collection')
  return { desired, minimums: actionMinima, liquidityRemoved, collects, calls }
}
