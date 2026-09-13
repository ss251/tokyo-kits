/** Public REST fields verified against Uniswap's OpenAPI on 2026-09-14.
 * https://trade-api.gateway.uniswap.org/v1/api.json
 * Deliberately supports same-chain CLASSIC AMM swaps; quote JSON is forwarded intact.
 */
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type JsonObject = { [key: string]: unknown };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface ApiOptions { fetch?: FetchLike; signal?: AbortSignal }
export const TRADING_API = 'https://trade-api.gateway.uniswap.org/v1';
export const ROUTER_VERSION = '2.1.1';
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';

export interface TransactionRequest {
  to: Address; from: Address; data: Hex; value: string; chainId: number;
  gasLimit?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string; gasPrice?: string;
}
export interface PreparedTransaction {
  status: 'UNSIGNED_NOT_EXECUTED';
  kind: 'swap' | 'create' | 'increase' | 'decrease';
  requestIds: string[];
  transaction: TransactionRequest;
}
export interface PermitData {
  domain: JsonObject;
  types: Record<string, { name: string; type: string }[]>;
  values: JsonObject;
}
export interface QuoteRequest {
  type: 'EXACT_INPUT' | 'EXACT_OUTPUT'; amount: string;
  tokenInChainId: number; tokenOutChainId: number;
  tokenIn: Address; tokenOut: Address; swapper: Address;
  recipient?: Address; slippageTolerance: number;
  routingPreference: 'BEST_PRICE'; protocols: ('V2' | 'V3' | 'V4')[];
  permitAmount: 'EXACT'; generatePermitAsTransaction: false;
  hooksOptions?: 'V4_HOOKS_INCLUSIVE' | 'V4_HOOKS_ONLY' | 'V4_NO_HOOKS';
}
export type QuoteInput = Omit<QuoteRequest, 'routingPreference' | 'permitAmount' | 'generatePermitAsTransaction' | 'slippageTolerance' | 'protocols'> & {
  slippageTolerance?: number; protocols?: QuoteRequest['protocols'];
};
export interface ClassicQuote extends JsonObject {
  chainId: number; quoteId: string; swapper: Address; tradeType: QuoteRequest['type'];
  input: JsonObject & { token: Address; amount: string };
  output: JsonObject & { token: Address; amount: string; recipient: Address };
  slippage: number; route: JsonObject[][];
}
export interface QuoteResponse {
  requestId: string; routing: 'CLASSIC'; quote: ClassicQuote; permitData: PermitData | null;
}
export interface SwapOptions extends ApiOptions {
  signPermit?: (permit: PermitData) => Promise<Hex>;
  /** Required outside the kit's pinned Base deployment before signing a permit. */
  expectedPermitSpender?: Address;
  simulateTransaction?: boolean; deadline?: number;
}
export interface PreparedSwap extends PreparedTransaction {
  kind: 'swap'; request: QuoteRequest; quoteResponse: QuoteResponse;
}

export function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}
export function address(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !/^0x[\da-fA-F]{40}$/.test(value)) throw new Error(`${label} must be a 20-byte address`);
  return value as Address;
}
export function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value;
}
export function amount(value: unknown, label: string, positive = true): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || (positive && BigInt(value) === 0n)) throw new Error(`${label} must be a ${positive ? 'positive' : 'nonnegative'} atomic-unit integer string`);
  return value;
}
export function slippage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) throw new Error('slippageTolerance must be > 0 and <= 100 percent with at most two decimals');
  return value;
}
export function textField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
export function requireApiKey(service: 'swap' | 'lp' = 'swap'): string {
  const key = (service === 'lp' ? process.env.UNISWAP_LP_API_KEY || process.env.UNISWAP_API_KEY : process.env.UNISWAP_API_KEY)?.trim();
  if (!key) throw new Error(`NOT PROVEN: missing ${service === 'lp' ? 'UNISWAP_LP_API_KEY (or UNISWAP_API_KEY)' : 'UNISWAP_API_KEY'}. Obtain access at https://developers.uniswap.org/dashboard and set the key in an ignored .env file.`);
  return key;
}

/** Endpoint hosts are fixed: credentials cannot be redirected to a caller-provided URL. */
export async function postApi(service: 'swap' | 'lp', endpoint: string, body: unknown, options: ApiOptions = {}): Promise<JsonObject> {
  const key = requireApiKey(service);
  const host = service === 'swap' ? TRADING_API : 'https://liquidity.api.uniswap.org';
  const allowed = service === 'swap' ? ['/quote', '/swap'] : ['/lp/create', '/lp/increase', '/lp/decrease'];
  if (!allowed.includes(endpoint)) throw new Error('Unsupported API endpoint');
  const response = await (options.fetch ?? fetch)(`${host}${endpoint}`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': key,
      ...(service === 'swap' ? { 'x-universal-router-version': ROUTER_VERSION } : {}) },
    body: JSON.stringify(body), signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  // Never echo arbitrary response bodies: they can reflect credentials or signatures.
  if (!response.ok) throw new Error(`Uniswap ${endpoint} HTTP ${response.status}; no transaction was executed`);
  let result: unknown;
  try { result = await response.json(); } catch { throw new Error(`Uniswap ${endpoint} returned invalid JSON`); }
  return object(result, `${endpoint} response`);
}

export function validateTransaction(value: unknown, expected: { chainId: number; walletAddress: Address }): TransactionRequest {
  const tx = object(value, 'transaction');
  const to = address(tx.to, 'transaction.to');
  if (BigInt(to) === 0n) throw new Error('transaction.to cannot be zero');
  const from = address(tx.from, 'transaction.from');
  if (from.toLowerCase() !== expected.walletAddress.toLowerCase()) throw new Error('transaction.from does not match the requested wallet');
  const chainId = integer(tx.chainId, 'transaction.chainId', 1);
  if (chainId !== expected.chainId) throw new Error('transaction.chainId does not match the requested chain');
  if (typeof tx.data !== 'string' || !/^0x(?:[\da-fA-F]{2})+$/.test(tx.data)) throw new Error('transaction.data must be nonempty hex calldata');
  const numeric = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !/^(?:\d+|0x[\da-fA-F]+)$/.test(value)) throw new Error(`${label} must be a nonnegative decimal or hex quantity`);
    return value;
  };
  const result: TransactionRequest = { to, from, data: tx.data as Hex, value: numeric(tx.value, 'transaction.value'), chainId };
  for (const key of ['gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'gasPrice'] as const) {
    if (tx[key] !== undefined) result[key] = numeric(tx[key], `transaction.${key}`);
  }
  return result;
}

export function buildQuoteRequest(input: QuoteInput): QuoteRequest {
  const tokenIn = address(input.tokenIn, 'tokenIn');
  const tokenOut = address(input.tokenOut, 'tokenOut');
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw new Error('Swap tokens must differ');
  if (input.type !== 'EXACT_INPUT' && input.type !== 'EXACT_OUTPUT') throw new Error('Unsupported trade type');
  const chainId = integer(input.tokenInChainId, 'tokenInChainId', 1);
  if (chainId !== integer(input.tokenOutChainId, 'tokenOutChainId', 1)) throw new Error('This starter supports same-chain CLASSIC swaps only');
  const protocols = input.protocols ?? ['V3', 'V4'];
  if (!protocols.length || protocols.some(p => !['V2', 'V3', 'V4'].includes(p))) throw new Error('This starter supports V2/V3/V4 protocols only');
  if (input.hooksOptions !== undefined && !['V4_HOOKS_INCLUSIVE', 'V4_HOOKS_ONLY', 'V4_NO_HOOKS'].includes(input.hooksOptions)) throw new Error('Invalid hooksOptions');
  return { type: input.type, amount: amount(input.amount, 'amount'), tokenInChainId: chainId, tokenOutChainId: chainId,
    tokenIn, tokenOut, swapper: address(input.swapper, 'swapper'),
    ...(input.recipient ? { recipient: address(input.recipient, 'recipient') } : {}),
    slippageTolerance: slippage(input.slippageTolerance ?? 0.5), routingPreference: 'BEST_PRICE',
    protocols: [...protocols], permitAmount: 'EXACT', generatePermitAsTransaction: false,
    ...(input.hooksOptions ? { hooksOptions: input.hooksOptions } : {}) };
}

export function validatePermitData(value: unknown): PermitData {
  const permit = object(value, 'permitData');
  const domain = object(permit.domain, 'permitData.domain');
  const values = object(permit.values, 'permitData.values');
  const types = object(permit.types, 'permitData.types');
  for (const [name, fields] of Object.entries(types)) {
    if (!Array.isArray(fields) || !fields.length) throw new Error(`permitData.types.${name} must be an array of fields`);
    for (const field of fields) {
      const entry = object(field, 'typed-data field');
      textField(entry.name, 'typed-data field name'); textField(entry.type, 'typed-data field type');
    }
  }
  if (!Object.keys(types).length) throw new Error('permitData.types cannot be empty');
  return { domain, values, types: types as PermitData['types'] };
}

export function validateQuoteResponse(value: unknown, request: QuoteRequest): QuoteResponse {
  const response = object(value, 'quote response');
  if (response.routing !== 'CLASSIC') throw new Error(`Unsupported quote routing: ${String(response.routing)}; this starter does not submit UniswapX orders`);
  const quote = object(response.quote, 'quote');
  const input = object(quote.input, 'quote.input'); const output = object(quote.output, 'quote.output');
  if (integer(quote.chainId, 'quote.chainId', 1) !== request.tokenInChainId) throw new Error('Quote chain mismatch');
  if (address(quote.swapper, 'quote.swapper').toLowerCase() !== request.swapper.toLowerCase()) throw new Error('Quote swapper mismatch');
  if (address(input.token, 'quote.input.token').toLowerCase() !== request.tokenIn.toLowerCase() || address(output.token, 'quote.output.token').toLowerCase() !== request.tokenOut.toLowerCase()) throw new Error('Quote token mismatch');
  if (address(output.recipient, 'quote.output.recipient').toLowerCase() !== (request.recipient ?? request.swapper).toLowerCase()) throw new Error('Quote recipient mismatch');
  amount(input.amount, 'quote.input.amount'); amount(output.amount, 'quote.output.amount');
  if (quote.tradeType !== request.type || BigInt((request.type === 'EXACT_INPUT' ? input.amount : output.amount) as string) !== BigInt(request.amount)) throw new Error('Quote trade amount/type mismatch');
  if (slippage(quote.slippage) > request.slippageTolerance) throw new Error('Quote exceeds requested slippage');
  if (!Array.isArray(quote.route) || !quote.route.length || quote.route.some(route => !Array.isArray(route) || !route.length || route.some(pool => !pool || typeof pool !== 'object'))) throw new Error('Quote route is missing or malformed');
  textField(quote.quoteId, 'quote.quoteId');
  if (response.permitTransaction != null) throw new Error('Unexpected permit transaction; this starter requested typed-data permits');
  const permitData = response.permitData === null ? null : validatePermitData(response.permitData);
  if (permitData) {
    if (Number(permitData.domain.chainId) !== request.tokenInChainId || address(permitData.domain.verifyingContract, 'permit verifier').toLowerCase() !== PERMIT2) throw new Error('Permit2 domain does not match the quote');
    const details = object(permitData.values.details, 'PermitSingle.details');
    if (address(details.token, 'permit token').toLowerCase() !== request.tokenIn.toLowerCase()) throw new Error('Permit token does not match the quote');
    amount(details.amount, 'permit amount');
    address(permitData.values.spender, 'permit spender');
  }
  return { requestId: textField(response.requestId, 'quote.requestId'), routing: 'CLASSIC', quote: quote as ClassicQuote, permitData };
}

export async function requestQuote(input: QuoteInput, options: ApiOptions = {}): Promise<QuoteResponse> {
  const request = buildQuoteRequest(input);
  return validateQuoteResponse(await postApi('swap', '/quote', request, options), request);
}

export async function requestSwap(quoteResponse: QuoteResponse, request: QuoteRequest, options: SwapOptions = {}): Promise<PreparedSwap> {
  requireApiKey();
  const validated = validateQuoteResponse(quoteResponse, request);
  let permitFields: { permitData?: PermitData; signature?: Hex } = {};
  if (validated.permitData) {
    if (!options.signPermit) throw new Error('A validated Permit2 signature is required before /swap; provide signPermit');
    const expectedSpender = options.expectedPermitSpender ?? (request.tokenInChainId === 8453 ? '0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7' : undefined);
    if (!expectedSpender || address(validated.permitData.values.spender, 'permit spender').toLowerCase() !== expectedSpender.toLowerCase()) throw new Error('Permit spender does not match the pinned Universal Router');
    const details = object(validated.permitData.values.details, 'PermitSingle.details');
    const maxInput = request.type === 'EXACT_INPUT' ? BigInt(request.amount)
      : (BigInt(validated.quote.input.amount) * BigInt(10_000 + Math.round(request.slippageTolerance * 100)) + 9_999n) / 10_000n;
    if (BigInt(amount(details.amount, 'permit amount')) > maxInput) throw new Error('Permit exceeds the bounded quote input allowance');
    const expectedTypes = {
      PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
      PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
    };
    for (const [name, expectedFields] of Object.entries(expectedTypes)) {
      const fields = validated.permitData.types[name];
      if (!fields || fields.length !== expectedFields.length || expectedFields.some((field, index) => fields[index]?.name !== field.name || fields[index]?.type !== field.type)) throw new Error('Unsupported PermitSingle typed-data schema');
    }
    const signature = await options.signPermit(validated.permitData);
    if (!/^0x(?:[\da-fA-F]{2})+$/.test(signature)) throw new Error('signPermit returned an invalid hex signature');
    permitFields = { permitData: validated.permitData, signature };
  }
  const response = await postApi('swap', '/swap', { quote: validated.quote, ...permitFields,
    simulateTransaction: options.simulateTransaction ?? false, refreshGasPrice: true,
    ...(options.deadline === undefined ? {} : { deadline: integer(options.deadline, 'deadline', 1) }) }, options);
  return { status: 'UNSIGNED_NOT_EXECUTED', kind: 'swap', requestIds: [validated.requestId, textField(response.requestId, 'swap.requestId')],
    transaction: validateTransaction(response.swap, { chainId: request.tokenInChainId, walletAddress: request.swapper }), request, quoteResponse: validated };
}

export async function prepareSwap(input: QuoteInput, options: SwapOptions = {}): Promise<PreparedSwap> {
  requireApiKey();
  const request = buildQuoteRequest(input);
  return requestSwap(await requestQuote(request, options), request, options);
}
