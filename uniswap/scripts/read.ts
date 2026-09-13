import { parseAbi, encodeAbiParameters, keccak256, type Address, type PublicClient } from 'viem'
import config from '../addresses.json'

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export const poolTuple = { type: 'tuple', components: [
  { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
] } as const
export function poolId(key: PoolKey) { return keccak256(encodeAbiParameters([poolTuple], [key])) }
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
  'function getTickBitmap(bytes32 poolId,int16 word) view returns (uint256)',
])
export const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)',
])

// Typed StateView and simulation pattern adapted from the user's earlier depth.ts.
// Integer amounts and errors are retained; failed quotes never become fabricated prices.
export async function readPool(client: PublicClient, key: PoolKey, blockNumber?: bigint) {
  const id = poolId(key)
  const slot0 = await client.readContract({ address: config.stateView as Address, abi: stateViewAbi, functionName: 'getSlot0', args: [id], blockNumber })
  const liquidity = await client.readContract({ address: config.stateView as Address, abi: stateViewAbi, functionName: 'getLiquidity', args: [id], blockNumber })
  const bitmapWord = Math.floor(Math.floor(slot0[1] / key.tickSpacing) / 256)
  const bitmap = await client.readContract({ address: config.stateView as Address, abi: stateViewAbi, functionName: 'getTickBitmap', args: [id, bitmapWord], blockNumber })
  return { poolId: id, sqrtPriceX96: slot0[0], tick: slot0[1], protocolFee: slot0[2], lpFee: slot0[3], liquidity, bitmapWord, bitmap }
}
export async function quoteV4(client: PublicClient, key: PoolKey, zeroForOne: boolean, exactAmount: bigint, account: Address) {
  const { result } = await client.simulateContract({ address: config.v4Quoter as Address, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey: key, zeroForOne, exactAmount, hookData: '0x' }], account })
  return { amountOut: result[0], gasEstimate: result[1] }
}
