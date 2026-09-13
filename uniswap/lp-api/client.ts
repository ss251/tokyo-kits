/** Public V3/V4 LP request fields: official LP guide and OpenAPI, 2026-09-14. */
import {
  address, amount, integer, object, postApi, slippage, textField, validatePermitData, validateTransaction,
  type Address, type ApiOptions, type Hex, type JsonObject, type PermitData, type PreparedTransaction,
} from '../api-swap/client';

export const LIQUIDITY_API = 'https://liquidity.api.uniswap.org';
export interface LPToken { tokenAddress: Address; amount: string }
export interface TokenPair { token0Address: Address; token1Address: Address }
export interface ExistingPool extends TokenPair { poolReference: Hex }
export interface NewPool extends TokenPair {
  fee: number; tickSpacing: number; initialPrice: string; hooks?: Address;
}
type PoolSpec = { existingPool: ExistingPool; newPool?: never } | { newPool: NewPool; existingPool?: never };
type RangeSpec = { tickBounds: { tickLower: number; tickUpper: number }; priceBounds?: never }
  | { priceBounds: { minPrice: string; maxPrice: string }; tickBounds?: never };
export interface CommonRequest {
  walletAddress: Address; chainId: number; protocol: 'V3' | 'V4';
  slippageTolerance?: number; deadline?: number; simulateTransaction?: boolean;
  urgency?: 'NORMAL' | 'FAST' | 'URGENT';
}
export type CreateRequest = CommonRequest & PoolSpec & RangeSpec & {
  independentToken: LPToken; dependentToken?: LPToken;
  batchPermitData?: PermitData; signature?: Hex; nativeTokenBalance?: string;
};
export interface PositionReference extends TokenPair { nftTokenId: string }
export interface IncreaseRequest extends CommonRequest, PositionReference {
  independentToken: LPToken; v4BatchPermitData?: PermitData; signature?: Hex;
}
export interface DecreaseRequest extends CommonRequest, PositionReference {
  liquidityPercentageToDecrease: number; withdrawAsWeth?: boolean;
}
export interface LPResponse {
  requestId: string; token0: LPToken; token1: LPToken; gasFee?: string;
}
export interface CreateResponse extends LPResponse {
  tickLower: number; tickUpper: number; adjustedMinPrice: string; adjustedMaxPrice: string;
}
export interface PreparedLP<K extends 'create' | 'increase' | 'decrease', R> extends PreparedTransaction {
  kind: K; request: R; response: K extends 'create' ? CreateResponse : LPResponse;
}

function common(input: CommonRequest): CommonRequest {
  if (input.protocol !== 'V3' && input.protocol !== 'V4') throw new Error('This LP starter supports V3/V4 NFT positions');
  if (input.urgency !== undefined && !['NORMAL', 'FAST', 'URGENT'].includes(input.urgency)) throw new Error('Invalid LP gas urgency');
  return { walletAddress: address(input.walletAddress, 'walletAddress'), chainId: integer(input.chainId, 'chainId', 1), protocol: input.protocol,
    slippageTolerance: slippage(input.slippageTolerance ?? 0.5), simulateTransaction: input.simulateTransaction ?? false,
    ...(input.deadline === undefined ? {} : { deadline: integer(input.deadline, 'deadline', 1) }),
    ...(input.urgency === undefined ? {} : { urgency: input.urgency }) };
}
function pair(input: TokenPair): TokenPair {
  const token0Address = address(input.token0Address, 'token0Address');
  const token1Address = address(input.token1Address, 'token1Address');
  if (BigInt(token0Address) >= BigInt(token1Address)) throw new Error('token0Address and token1Address must be distinct and sorted numerically; do not reverse an existing position');
  return { token0Address, token1Address };
}
function token(input: LPToken, tokens: TokenPair, positive = true): LPToken {
  const tokenAddress = address(input.tokenAddress, 'LP token address');
  if (![tokens.token0Address, tokens.token1Address].some(t => t.toLowerCase() === tokenAddress.toLowerCase())) throw new Error('LP token is not in the requested pair');
  return { tokenAddress, amount: amount(input.amount, 'LP token amount', positive) };
}
function ticks(lower: unknown, upper: unknown): { tickLower: number; tickUpper: number } {
  const tickLower = integer(lower, 'tickLower', -887272); const tickUpper = integer(upper, 'tickUpper', -887272);
  if (tickUpper > 887272 || tickLower >= tickUpper) throw new Error('Invalid ordered tick range');
  return { tickLower, tickUpper };
}
function prices(lower: unknown, upper: unknown): { minPrice: string; maxPrice: string } {
  const parse = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`${label} must be a positive decimal string`);
    const [whole = '0', fraction = ''] = value.split('.');
    const numerator = BigInt(whole + fraction);
    if (numerator === 0n) throw new Error(`${label} must be positive`);
    return { value, numerator, denominator: 10n ** BigInt(fraction.length) };
  };
  const min = parse(lower, 'minPrice'); const max = parse(upper, 'maxPrice');
  if (min.numerator * max.denominator >= max.numerator * min.denominator) throw new Error('minPrice must be below maxPrice');
  return { minPrice: min.value, maxPrice: max.value };
}
function permit(input: { signature?: Hex }, data: PermitData | undefined, protocol: CommonRequest['protocol']): { data?: PermitData; signature?: Hex } {
  if ((data !== undefined) !== (input.signature !== undefined)) throw new Error('LP permit data and signature must be supplied together');
  if (data === undefined) return {};
  if (protocol !== 'V4') throw new Error('Batch Permit2 fields are V4-only');
  if (!/^0x(?:[\da-fA-F]{2})+$/.test(input.signature!)) throw new Error('LP permit signature must be nonempty hex');
  return { data: validatePermitData(data), signature: input.signature };
}

export function buildCreateRequest(input: CreateRequest): CreateRequest {
  const shared = common(input);
  if (Boolean(input.existingPool) === Boolean(input.newPool)) throw new Error('Provide exactly one of existingPool or newPool');
  if (Boolean(input.tickBounds) === Boolean(input.priceBounds)) throw new Error('Provide exactly one of tickBounds or priceBounds');
  const tokens = pair(input.existingPool ?? input.newPool!);
  let poolSpec: PoolSpec;
  if (input.existingPool) {
    const ref = input.existingPool.poolReference;
    if (typeof ref !== 'string' || !(shared.protocol === 'V3' ? /^0x[\da-fA-F]{40}$/ : /^0x[\da-fA-F]{64}$/).test(ref)) throw new Error('poolReference must be a V3 pool address or V4 bytes32 pool ID');
    poolSpec = { existingPool: { ...tokens, poolReference: ref } };
  } else {
    const pool = input.newPool!;
    const fee = integer(pool.fee, 'fee');
    if (fee > 1_000_000 && !(shared.protocol === 'V4' && fee === 0x800000)) throw new Error('fee is outside the supported pool fee range');
    const tickSpacing = integer(pool.tickSpacing, 'tickSpacing', 1);
    if (tickSpacing > 32767) throw new Error('tickSpacing must fit the V4 positive int16 range');
    if (shared.protocol === 'V3' && pool.hooks !== undefined) throw new Error('hooks is V4-only');
    poolSpec = { newPool: { ...tokens, fee, tickSpacing, initialPrice: amount(pool.initialPrice, 'initialPrice sqrtRatioX96'),
      ...(pool.hooks === undefined ? {} : { hooks: address(pool.hooks, 'hooks') }) } };
  }
  const rangeSpec: RangeSpec = input.tickBounds ? { tickBounds: ticks(input.tickBounds.tickLower, input.tickBounds.tickUpper) }
    : { priceBounds: prices(input.priceBounds!.minPrice, input.priceBounds!.maxPrice) };
  if (poolSpec.newPool && rangeSpec.tickBounds && (rangeSpec.tickBounds.tickLower % poolSpec.newPool.tickSpacing !== 0 || rangeSpec.tickBounds.tickUpper % poolSpec.newPool.tickSpacing !== 0)) throw new Error('Ticks must be aligned with the new pool tickSpacing');
  const signed = permit(input, input.batchPermitData, shared.protocol);
  const independentToken = token(input.independentToken, tokens);
  const dependentToken = input.dependentToken === undefined ? undefined : token(input.dependentToken, tokens, false);
  if (dependentToken?.tokenAddress.toLowerCase() === independentToken.tokenAddress.toLowerCase()) throw new Error('dependentToken must be the other pool token');
  return { ...shared, ...poolSpec, ...rangeSpec, independentToken,
    ...(dependentToken === undefined ? {} : { dependentToken }),
    ...(signed.data === undefined ? {} : { batchPermitData: signed.data, signature: signed.signature }),
    ...(input.nativeTokenBalance === undefined ? {} : { nativeTokenBalance: amount(input.nativeTokenBalance, 'nativeTokenBalance', false) }) };
}
export function buildIncreaseRequest(input: IncreaseRequest): IncreaseRequest {
  const shared = common(input); const tokens = pair(input);
  const signed = permit(input, input.v4BatchPermitData, shared.protocol);
  return { ...shared, ...tokens, nftTokenId: amount(input.nftTokenId, 'nftTokenId', false), independentToken: token(input.independentToken, tokens),
    ...(signed.data === undefined ? {} : { v4BatchPermitData: signed.data, signature: signed.signature }) };
}
export function buildDecreaseRequest(input: DecreaseRequest): DecreaseRequest {
  const shared = common(input); const tokens = pair(input);
  const percentage = integer(input.liquidityPercentageToDecrease, 'liquidityPercentageToDecrease', 1);
  if (percentage > 100) throw new Error('liquidityPercentageToDecrease must be 1..100');
  if (input.withdrawAsWeth !== undefined && shared.protocol !== 'V3') throw new Error('withdrawAsWeth is V3-only');
  return { ...shared, ...tokens, nftTokenId: amount(input.nftTokenId, 'nftTokenId', false), liquidityPercentageToDecrease: percentage,
    ...(input.withdrawAsWeth === undefined ? {} : { withdrawAsWeth: input.withdrawAsWeth }) };
}

function responseFields(response: JsonObject, tokens: TokenPair): LPResponse {
  const token0 = object(response.token0, 'response.token0'); const token1 = object(response.token1, 'response.token1');
  const parsed0 = token({ tokenAddress: address(token0.tokenAddress, 'response.token0.tokenAddress'), amount: amount(token0.amount, 'response.token0.amount', false) }, tokens, false);
  const parsed1 = token({ tokenAddress: address(token1.tokenAddress, 'response.token1.tokenAddress'), amount: amount(token1.amount, 'response.token1.amount', false) }, tokens, false);
  if (parsed0.tokenAddress.toLowerCase() !== tokens.token0Address.toLowerCase() || parsed1.tokenAddress.toLowerCase() !== tokens.token1Address.toLowerCase()) throw new Error('LP response token order does not match the request');
  return { requestId: textField(response.requestId, 'LP requestId'), token0: parsed0, token1: parsed1,
    ...(response.gasFee === undefined ? {} : { gasFee: amount(response.gasFee, 'gasFee', false) }) };
}
export async function requestCreate(input: CreateRequest, options: ApiOptions = {}): Promise<PreparedLP<'create', CreateRequest>> {
  const request = buildCreateRequest(input);
  const raw = await postApi('lp', '/lp/create', request, options);
  const response: CreateResponse = { ...responseFields(raw, request.existingPool ?? request.newPool!),
    ...ticks(raw.tickLower, raw.tickUpper),
    adjustedMinPrice: textField(raw.adjustedMinPrice, 'adjustedMinPrice'), adjustedMaxPrice: textField(raw.adjustedMaxPrice, 'adjustedMaxPrice') };
  prices(response.adjustedMinPrice, response.adjustedMaxPrice);
  return { kind: 'create', status: 'UNSIGNED_NOT_EXECUTED', requestIds: [response.requestId], request, response,
    transaction: validateTransaction(raw.create, request) };
}
export async function requestIncrease(input: IncreaseRequest, options: ApiOptions = {}): Promise<PreparedLP<'increase', IncreaseRequest>> {
  const request = buildIncreaseRequest(input);
  const raw = await postApi('lp', '/lp/increase', request, options); const response = responseFields(raw, request);
  return { kind: 'increase', status: 'UNSIGNED_NOT_EXECUTED', requestIds: [response.requestId], request, response,
    transaction: validateTransaction(raw.increase, request) };
}
export async function requestDecrease(input: DecreaseRequest, options: ApiOptions = {}): Promise<PreparedLP<'decrease', DecreaseRequest>> {
  const request = buildDecreaseRequest(input);
  const raw = await postApi('lp', '/lp/decrease', request, options); const response = responseFields(raw, request);
  return { kind: 'decrease', status: 'UNSIGNED_NOT_EXECUTED', requestIds: [response.requestId], request, response,
    transaction: validateTransaction(raw.decrease, request) };
}
