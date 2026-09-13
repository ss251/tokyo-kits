import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildQuoteRequest, prepareSwap, requireApiKey, validateTransaction, type Address, type FetchLike,
  type PermitData, type QuoteInput, type TransactionRequest,
} from '../api-swap/client';
import {
  buildCreateRequest, buildDecreaseRequest, buildIncreaseRequest, requestCreate, requestDecrease, requestIncrease,
  type CreateRequest, type DecreaseRequest, type IncreaseRequest,
} from '../lp-api/client';

// SYNTHETIC OFFLINE UNIT FIXTURES. These are neither API captures nor proof receipts.
const wallet: Address = '0x1111111111111111111111111111111111111111';
const weth: Address = '0x4200000000000000000000000000000000000006';
const usdc: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const router: Address = '0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7';
const pool: Address = '0xd0b53D9277642d899DF5C87A3966A349A798F224';
const tx = (): TransactionRequest => ({ to: router, from: wallet, data: '0x12345678', value: '0x00', chainId: 8453 });
const input = (): QuoteInput => ({ type: 'EXACT_INPUT', amount: '1000', tokenInChainId: 8453, tokenOutChainId: 8453,
  tokenIn: weth, tokenOut: usdc, swapper: wallet });
const quote = (permitData: PermitData | null = null) => ({
  requestId: 'unit-quote', routing: 'CLASSIC', permitData,
  quote: { chainId: 8453, quoteId: 'unit-quote-id', swapper: wallet, tradeType: 'EXACT_INPUT', slippage: 0.5,
    input: { token: weth, amount: '1000' }, output: { token: usdc, amount: '2000', recipient: wallet },
    route: [[{ type: 'v3-pool', address: pool }]], routeString: 'synthetic offline unit route',
    additiveFutureField: { preserve: true } },
});
const permit = (): PermitData => ({ domain: { name: 'Permit2', chainId: 8453, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
  types: {
    PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
    PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
  }, values: { details: { token: weth, amount: '1000', expiration: '2000000000', nonce: '0' }, spender: router, sigDeadline: '2000000000' } });
const createInput = () => ({ walletAddress: wallet, chainId: 8453, protocol: 'V3',
  existingPool: { token0Address: weth, token1Address: usdc, poolReference: pool },
  independentToken: { tokenAddress: weth, amount: '1000' }, tickBounds: { tickLower: -887270, tickUpper: 887270 } } satisfies CreateRequest);
const increaseInput = (): IncreaseRequest => ({ walletAddress: wallet, chainId: 8453, protocol: 'V3', token0Address: weth,
  token1Address: usdc, nftTokenId: '42', independentToken: { tokenAddress: weth, amount: '1000' } });
const decreaseInput = (): DecreaseRequest => ({ walletAddress: wallet, chainId: 8453, protocol: 'V3', token0Address: weth,
  token1Address: usdc, nftTokenId: '42', liquidityPercentageToDecrease: 1 });
const lpResponse = (kind: 'create' | 'increase' | 'decrease') => ({ requestId: `unit-${kind}`,
  token0: { tokenAddress: weth, amount: '1000' }, token1: { tokenAddress: usdc, amount: '2000' },
  ...(kind === 'create' ? { tickLower: -10, tickUpper: 10, adjustedMinPrice: '0.9', adjustedMaxPrice: '1.1' } : {}),
  [kind]: tx(),
});
function offlineFetch(responses: unknown[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (!responses.length) throw new Error('Unexpected offline unit fixture request');
    return Response.json(responses.shift());
  };
  return { fetch, calls };
}

describe('Uniswap API clients — offline unit fixtures, no live proof', () => {
  let previousSwap: string | undefined; let previousLP: string | undefined;
  beforeEach(() => {
    previousSwap = process.env.UNISWAP_API_KEY; previousLP = process.env.UNISWAP_LP_API_KEY;
    process.env.UNISWAP_API_KEY = 'unit-fixture-not-a-real-key'; delete process.env.UNISWAP_LP_API_KEY;
  });
  afterEach(() => {
    if (previousSwap === undefined) delete process.env.UNISWAP_API_KEY; else process.env.UNISWAP_API_KEY = previousSwap;
    if (previousLP === undefined) delete process.env.UNISWAP_LP_API_KEY; else process.env.UNISWAP_LP_API_KEY = previousLP;
  });

  test('missing credentials fail before any request or signer invocation', async () => {
    delete process.env.UNISWAP_API_KEY;
    const transport = offlineFetch([]);
    await expect(prepareSwap(input(), transport)).rejects.toThrow('NOT PROVEN: missing UNISWAP_API_KEY');
    expect(transport.calls).toHaveLength(0);
    expect(() => requireApiKey('lp')).toThrow('NOT PROVEN');
  });
  test('requests keep the router version consistent, preserve opaque quote fields, and omit absent permit fields', async () => {
    const quoted = quote(); const transport = offlineFetch([quoted, { requestId: 'unit-swap', swap: tx() }]);
    const result = await prepareSwap(input(), transport);
    expect(transport.calls.map(c => c.url)).toEqual(['https://trade-api.gateway.uniswap.org/v1/quote', 'https://trade-api.gateway.uniswap.org/v1/swap']);
    expect(transport.calls.every(c => c.headers.get('x-universal-router-version') === '2.1.1')).toBe(true);
    expect(transport.calls[1]!.body.quote).toEqual(quoted.quote);
    expect(transport.calls[1]!.body).not.toHaveProperty('permitData');
    expect(transport.calls[1]!.body).not.toHaveProperty('signature');
    expect(result.status).toBe('UNSIGNED_NOT_EXECUTED');
    expect(result.transaction.value).toBe('0x00');
    expect(result).not.toHaveProperty('transactionHash');
  });
  test('signs a bounded PermitSingle and sends signature and permitData together', async () => {
    const data = permit(); const transport = offlineFetch([quote(data), { requestId: 'unit-swap', swap: tx() }]);
    let signed: PermitData | undefined;
    await prepareSwap(input(), { ...transport, signPermit: async p => { signed = p; return '0x1234'; } });
    expect(signed).toEqual(data);
    expect(transport.calls[1]!.body.permitData).toEqual(data);
    expect(transport.calls[1]!.body.signature).toBe('0x1234');
  });
  test('refuses an excessive permit before the signer can authorize it', async () => {
    const data = permit(); data.values.details = { token: weth, amount: '999999999', expiration: '2000000000', nonce: '0' };
    let signed = false; const transport = offlineFetch([quote(data)]);
    await expect(prepareSwap(input(), { ...transport, signPermit: async () => { signed = true; return '0x1234'; } })).rejects.toThrow('bounded quote input');
    expect(signed).toBe(false); expect(transport.calls).toHaveLength(1);
  });
  test('rejects routes for a different workflow instead of calling /swap', async () => {
    const transport = offlineFetch([{ ...quote(), routing: 'DUTCH_V3' }]);
    await expect(prepareSwap(input(), transport)).rejects.toThrow('Unsupported quote routing');
    expect(transport.calls).toHaveLength(1);
  });
  test('rejects changed quote recipient and quoted amount', async () => {
    const wrongRecipient = quote(); wrongRecipient.quote.output.recipient = router;
    await expect(prepareSwap(input(), offlineFetch([wrongRecipient]))).rejects.toThrow('recipient mismatch');
    const wrongAmount = quote(); wrongAmount.quote.input.amount = '999';
    await expect(prepareSwap(input(), offlineFetch([wrongAmount]))).rejects.toThrow('amount/type mismatch');
  });
  test('unsigned transaction validation rejects empty calldata, wrong chain, and wrong sender', () => {
    const expected = { walletAddress: wallet, chainId: 8453 };
    expect(() => validateTransaction({ ...tx(), data: '0x' }, expected)).toThrow('nonempty hex');
    expect(() => validateTransaction({ ...tx(), chainId: 1 }, expected)).toThrow('requested chain');
    expect(() => validateTransaction({ ...tx(), from: router }, expected)).toThrow('requested wallet');
    expect(() => validateTransaction({ ...tx(), value: '-1' }, expected)).toThrow('nonnegative');
  });
  test('quote builder rejects cross-chain routes and invalid units', () => {
    expect(() => buildQuoteRequest({ ...input(), tokenOutChainId: 1 })).toThrow('same-chain');
    expect(() => buildQuoteRequest({ ...input(), amount: '0.1' })).toThrow('atomic-unit');
    expect(buildQuoteRequest(input())).toMatchObject({ permitAmount: 'EXACT', routingPreference: 'BEST_PRICE', slippageTolerance: 0.5 });
  });
  test('LP requests use the dedicated host and prefer the LP entitlement key', async () => {
    process.env.UNISWAP_LP_API_KEY = 'unit-lp-fixture-not-a-real-key';
    const transport = offlineFetch([lpResponse('create'), lpResponse('increase'), lpResponse('decrease')]);
    const prepared = [await requestCreate(createInput(), transport), await requestIncrease(increaseInput(), transport), await requestDecrease(decreaseInput(), transport)];
    expect(transport.calls.map(c => c.url)).toEqual(['https://liquidity.api.uniswap.org/lp/create', 'https://liquidity.api.uniswap.org/lp/increase', 'https://liquidity.api.uniswap.org/lp/decrease']);
    expect(transport.calls.every(c => c.headers.get('x-api-key') === 'unit-lp-fixture-not-a-real-key')).toBe(true);
    expect(prepared.every(p => p.status === 'UNSIGNED_NOT_EXECUTED')).toBe(true);
  });
  test('create/increase preserve the endpoint-specific batch permit field names', () => {
    const batch: PermitData = { domain: { name: 'Permit2' }, types: { PermitBatch: [{ name: 'spender', type: 'address' }] }, values: { spender: router } };
    const created = buildCreateRequest({ ...createInput(), protocol: 'V4', existingPool: { token0Address: weth, token1Address: usdc, poolReference: `0x${'11'.repeat(32)}` }, batchPermitData: batch, signature: '0x1234' });
    const increased = buildIncreaseRequest({ ...increaseInput(), protocol: 'V4', v4BatchPermitData: batch, signature: '0x1234' });
    expect(created).toHaveProperty('batchPermitData'); expect(created).not.toHaveProperty('v4BatchPermitData');
    expect(increased).toHaveProperty('v4BatchPermitData'); expect(increased).not.toHaveProperty('batchPermitData');
  });
  test('LP range and token checks refuse incorrect position construction', () => {
    expect(() => buildCreateRequest({ ...createInput(), tickBounds: { tickLower: 10, tickUpper: -10 } })).toThrow('tick range');
    expect(() => buildCreateRequest({ ...createInput(), independentToken: { tokenAddress: router, amount: '1000' } })).toThrow('not in the requested pair');
    expect(() => buildIncreaseRequest({ ...increaseInput(), token0Address: usdc, token1Address: weth })).toThrow('sorted');
    expect(() => buildIncreaseRequest({ ...increaseInput(), nftTokenId: '' })).toThrow('nftTokenId');
    expect(() => buildDecreaseRequest({ ...decreaseInput(), liquidityPercentageToDecrease: 0.5 })).toThrow('integer');
    expect(() => buildDecreaseRequest({ ...decreaseInput(), liquidityPercentageToDecrease: 101 })).toThrow('1..100');
    expect(() => buildDecreaseRequest({ ...decreaseInput(), protocol: 'V4', withdrawAsWeth: true })).toThrow('V3-only');
  });
  test('malformed successful LP responses cannot become prepared transactions', async () => {
    const response = lpResponse('increase'); response.token1.tokenAddress = weth;
    await expect(requestIncrease(increaseInput(), offlineFetch([response]))).rejects.toThrow('token order');
  });
  test('HTTP errors are failures and do not echo a response body that could contain secrets', async () => {
    const fetch: FetchLike = async () => new Response('reflected-secret-key', { status: 401 });
    await expect(prepareSwap(input(), { fetch })).rejects.toThrow('HTTP 401; no transaction was executed');
  });
});
