import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import { expectedBurnMinimums, expectedMintMinimums, nfpmExecutionAbi, validateLpCalldata, type LpExecutionContext } from '../scripts/lp-validation'

const owner = '0x0000000000000000000000000000000000000001' as const
const token0 = '0x0000000000000000000000000000000000000002' as const
const token1 = '0x0000000000000000000000000000000000000003' as const
const stranger = '0x0000000000000000000000000000000000000004' as const
const base: LpExecutionContext = {
  kind: 'create', owner, chainId: 8453, token0, token1, decimals: [18, 18], fee: 500, tickLower: -600, tickUpper: 600,
  pool: { sqrtPriceX96: 1n << 96n, tick: 0, liquidity: 10n ** 18n },
  tokenId: 42n, liquidityAtQuote: 10_000_000n,
  independentToken: { tokenAddress: token0, amount: '1000000' },
  quoteAmounts: [1_000_000n, 2_000_000n], slippagePercent: 0.5, now: 1000n,
}
const mintParams = {
  token0, token1, fee: 500, tickLower: -600, tickUpper: 600,
  amount0Desired: 1_000_000n, amount1Desired: 2_010_000n,
  amount0Min: 995_000n, amount1Min: 1_990_000n, recipient: owner, deadline: 2000n,
}
const mint = (patch: Partial<typeof mintParams> = {}) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'mint', args: [{ ...mintParams, ...patch }] })
const multi = (...calls: Hex[]) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'multicall', args: [calls] })
const decreaseParams = { tokenId: 42n, liquidity: 100_000n, amount0Min: 995_000n, amount1Min: 1_990_000n, deadline: 2000n }
const decrease = (patch: Partial<typeof decreaseParams> = {}) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'decreaseLiquidity', args: [{ ...decreaseParams, ...patch }] })
const collectParams = { tokenId: 42n, recipient: owner, amount0Max: (1n << 128n) - 1n, amount1Max: (1n << 128n) - 1n }
const collect = (patch: Partial<typeof collectParams> = {}) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'collect', args: [{ ...collectParams, ...patch }] })
const withdrawal: LpExecutionContext = { ...base, kind: 'decrease', decreasePercentage: 1 }

describe('LP API execution intent validation', () => {
  test('extracts exact deposit ceilings from nested official multicalls', () => {
    const result = validateLpCalldata(multi(multi(mint())), base)
    expect(result.desired).toEqual([1_000_000n, 2_010_000n])
    expect(result.minimums).toEqual([995_000n, 1_990_000n])
    expect(result.calls).toBe(3)
  })

  test('rejects 1000x overspending even when the destination is the official NFPM', () => {
    expect(() => validateLpCalldata(mint({ amount0Desired: 1_000_000_000n }), base)).toThrow('bounded quote/request')
    expect(() => validateLpCalldata(mint(), { ...base, quoteAmounts: [1_000_001n, 2_000_000n] })).toThrow('independent-token request')
    expect(() => validateLpCalldata(mint({ amount1Desired: 2_010_001n }), base)).toThrow('bounded quote/request')
  })

  test('rejects a different pool, range, or recipient', () => {
    expect(() => validateLpCalldata(mint(), { ...base, owner: stranger })).toThrow('recipient')
    expect(() => validateLpCalldata(mint(), { ...base, token1: stranger })).toThrow('token1')
    expect(() => validateLpCalldata(mint({ fee: 3000 }), base)).toThrow('fee')
    expect(() => validateLpCalldata(mint({ tickLower: -660 }), base)).toThrow('lower tick')
    expect(() => validateLpCalldata(mint({ tickUpper: 660 }), base)).toThrow('upper tick')
  })

  test('rejects weak slippage guards and expired or unbounded deadlines', () => {
    expect(() => validateLpCalldata(mint({ amount0Min: 0n }), base)).toThrow('slippage')
    const [floor0, floor1] = expectedMintMinimums(base, mintParams.amount0Desired, mintParams.amount1Desired)
    expect(floor0 > 0n && floor0 < mintParams.amount0Min && floor1 > 0n && floor1 < mintParams.amount1Min).toBe(true)
    expect(validateLpCalldata(mint({ amount0Min: floor0, amount1Min: floor1 }), base).minimums).toEqual([floor0, floor1])
    expect(() => validateLpCalldata(mint({ amount0Min: floor0 - 1n }), base)).toThrow('slippage')
    expect(() => validateLpCalldata(mint({ amount1Min: floor1 - 1n }), base)).toThrow('slippage')
    expect(() => validateLpCalldata(mint({ deadline: base.now }), base)).toThrow('deadline')
    expect(() => validateLpCalldata(mint({ deadline: base.now + 86401n }), base)).toThrow('deadline')
  })

  test('rejects unrelated selectors, additional mutations, and unbounded nesting', () => {
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [stranger, 1n] })
    expect(() => validateLpCalldata(multi(mint(), approve), base)).toThrow('Unsupported NFPM selector')
    expect(() => validateLpCalldata(multi(mint(), mint()), base)).toThrow('one LP mutation')
    expect(() => validateLpCalldata(multi(), base)).toThrow('Empty')
    expect(() => validateLpCalldata(multi(multi(multi(multi(multi(mint()))))), base)).toThrow('nesting/count')
  })

  test('increase is bound to the selected public NFT and exact input ceiling', () => {
    const params = { tokenId: 42n, amount0Desired: 1_000_000n, amount1Desired: 2_000_000n, amount0Min: 995_000n, amount1Min: 1_990_000n, deadline: 2000n }
    const call = encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'increaseLiquidity', args: [params] })
    expect(validateLpCalldata(call, { ...base, kind: 'increase' }).desired).toEqual([1_000_000n, 2_000_000n])
    expect(() => validateLpCalldata(call, { ...base, kind: 'increase', tokenId: 43n })).toThrow('another public NFT')
    expect(() => validateLpCalldata(call, base)).toThrow('Unexpected increase')
  })

  test('decrease plus collection requires no spending approval and removes the requested percentage', () => {
    const result = validateLpCalldata(multi(decrease(), collect()), withdrawal)
    expect(result.desired).toEqual([0n, 0n])
    expect(result.liquidityRemoved).toBe(100_000n)
    expect(result.collects).toBe(1)
    expect(() => validateLpCalldata(multi(decrease({ liquidity: 100_001n }), collect()), withdrawal)).toThrow('percentage')
    expect(() => validateLpCalldata(multi(decrease({ tokenId: 43n }), collect()), withdrawal)).toThrow('another public NFT')
  })

  test('withdrawals cannot redirect collections, omit them, or reduce output protection', () => {
    expect(() => validateLpCalldata(multi(decrease(), collect()), { ...withdrawal, owner: stranger })).toThrow('recipient')
    expect(() => validateLpCalldata(multi(decrease(), collect({ tokenId: 43n })), withdrawal)).toThrow('another public NFT')
    expect(() => validateLpCalldata(decrease(), withdrawal)).toThrow('Missing requested LP action or collection')
    expect(() => validateLpCalldata(multi(collect(), decrease()), withdrawal)).toThrow('follow the sole decrease')
    expect(() => validateLpCalldata(multi(decrease({ amount0Min: 0n }), collect()), withdrawal)).toThrow('withdrawal minimum')
    const [burn0, burn1] = expectedBurnMinimums(withdrawal, decreaseParams.liquidity)
    expect(burn0 > 0n && burn1 > 0n).toBe(true)
    expect(validateLpCalldata(multi(decrease({ amount0Min: burn0, amount1Min: burn1 }), collect()), withdrawal).minimums).toEqual([burn0, burn1])
    expect(() => validateLpCalldata(multi(decrease({ amount0Min: burn0 - 1n }), collect()), withdrawal)).toThrow('withdrawal minimum')
    expect(() => validateLpCalldata(multi(decrease(), collect({ amount0Max: 1n })), withdrawal)).toThrow('withdrawal minimums')
  })

  // Live Base WETH/USDC 0.3% position 6013178 observed 2026-09-17 (pool state at block 51400934):
  // the LP API's calldata minimums come from price-based slippage, roughly 3.5% below the desired amounts.
  const liveOwner = '0xe85fe0E1066d0E3e0d5275c48327722BAc6a2AF8' as const
  const live: LpExecutionContext = {
    kind: 'increase', owner: liveOwner, chainId: 8453, token0: '0x4200000000000000000000000000000000000006', token1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: [18, 6], fee: 3000, tickLower: -200040, tickUpper: -197040,
    pool: { sqrtPriceX96: 3889888797783930625651435n, tick: -198445, liquidity: 37267162262556957075n },
    tokenId: 6013178n, liquidityAtQuote: 61935563480041n, independentToken: { tokenAddress: '0x4200000000000000000000000000000000000006', amount: '1000000000000000' },
    quoteAmounts: [1000000000000000n, 2727177n], slippagePercent: 0.5, now: 1789592000n,
  }
  test('accepts the live API increase and decrease calldata whose minimums follow SDK price slippage', () => {
    const increase = { tokenId: 6013178n, amount0Desired: 999999769427590n, amount1Desired: 2727177n, amount0Min: 963259036775483n, amount1Min: 2638169n, deadline: 1789592841n }
    const call = (patch: Partial<typeof increase> = {}) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'increaseLiquidity', args: [{ ...increase, ...patch }] })
    expect(validateLpCalldata(call(), live).minimums).toEqual([963259036775483n, 2638169n])
    expect(() => validateLpCalldata(call({ amount0Min: 963259036775483n * 99n / 100n }), live)).toThrow('slippage')
    const withdrawal = { ...live, kind: 'decrease' as const, decreasePercentage: 1, quoteAmounts: [855163151747505n, 2332181n] as const }
    const decreaseCall = (patch = {}) => encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'decreaseLiquidity', args: [{ tokenId: 6013178n, liquidity: 619355634800n, amount0Min: 823743823770241n, amount1Min: 2256064n, deadline: 1789592842n, ...patch }] })
    const collectCall = encodeFunctionData({ abi: nfpmExecutionAbi, functionName: 'collect', args: [{ tokenId: 6013178n, recipient: liveOwner, amount0Max: (1n << 128n) - 1n, amount1Max: (1n << 128n) - 1n }] })
    expect(validateLpCalldata(multi(decreaseCall(), collectCall), withdrawal).liquidityRemoved).toBe(619355634800n)
    expect(() => validateLpCalldata(multi(decreaseCall({ amount1Min: 2256064n * 99n / 100n }), collectCall), withdrawal)).toThrow('withdrawal minimum')
  })
})
