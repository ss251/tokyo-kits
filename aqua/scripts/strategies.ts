// SPDX-License-Identifier: MIT
import {
  AQUA_SWAP_VM_CONTRACT_ADDRESSES,
  Address,
  AquaPeggedAmmStrategy,
  AquaProgramBuilder,
  HexString,
  MakerTraits,
  Order,
  SwapVMContract,
  SwapVmProgram,
  TakerTraits,
  instructions,
} from '@1inch/swap-vm-sdk';
import {
  AQUA_CONTRACT_ADDRESSES,
  Address as AquaAddress,
  AquaProtocolContract,
  HexString as AquaHexString,
} from '@1inch/aqua-sdk';
import { concatHex, encodeAbiParameters, getAddress, type Hex } from 'viem';

export type SupportedChainId = 137 | 8453;
export type TokenAllocation = { token: Hex; amount: bigint };
export type PeggedToken = { address: Hex; decimals: number; reserve: bigint };
export type SwapParameters = {
  order: Order;
  tokenIn: Hex;
  tokenOut: Hex;
  amount: bigint;
  exactIn?: boolean;
  threshold?: bigint;
  strictThreshold?: boolean;
  deadline?: bigint;
};

const OFFICIAL_AQUA = '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a' as const;
const OFFICIAL_ROUTER = '0x111111338c5091e8440b67b168bae16a668ac0de' as const;
const UINT256_MAX = (1n << 256n) - 1n;

function address(value: Hex): Hex {
  const result = getAddress(value);
  if (BigInt(result) === 0n) throw new Error('Zero address is not allowed');
  return result;
}

function positive(value: bigint, label: string): void {
  if (value <= 0n || value > UINT256_MAX) throw new Error(`${label} must be a positive uint256`);
}

function pair(token0: Hex, token1: Hex): [Hex, Hex] {
  const first = address(token0);
  const second = address(token1);
  if (first === second) throw new Error('A strategy requires two distinct tokens');
  return [first, second];
}

/** Refuse unknown chains and SDK address changes rather than silently changing the deployment. */
export function getOfficialDeployments(chainId: SupportedChainId = 137) {
  if (chainId !== 137 && chainId !== 8453) throw new Error('Only Polygon and Base forks are supported');
  const aqua = AQUA_CONTRACT_ADDRESSES[chainId].toString();
  const router = AQUA_SWAP_VM_CONTRACT_ADDRESSES[chainId].toString();
  if (aqua.toLowerCase() !== OFFICIAL_AQUA || router.toLowerCase() !== OFFICIAL_ROUTER) {
    throw new Error('Pinned SDK deployment differs from the verified official contracts');
  }
  return { chainId, aqua, router };
}

/** SDK normalizes decimals and orders reserves by numeric token address. */
export function buildPeggedOrder(
  maker: Hex,
  tokenA: PeggedToken,
  tokenB: PeggedToken,
  options: { linearWidth?: bigint; salt?: bigint; feeBps?: number } = {},
): Order {
  const [first, second] = pair(tokenA.address, tokenB.address);
  for (const token of [tokenA, tokenB]) {
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 77) {
      throw new Error('Token decimals must be an integer from 0 to 77');
    }
    positive(token.reserve, 'Reserve');
  }
  const linearWidth = options.linearWidth ?? 8n * 10n ** 26n;
  if (linearWidth < 0n) throw new Error('Linear width cannot be negative');
  const strategy = AquaPeggedAmmStrategy.new({
    tokenA: { ...tokenA, address: new Address(first) },
    tokenB: { ...tokenB, address: new Address(second) },
    linearWidth,
  });
  if (options.salt !== undefined) {
    positive(options.salt, 'Salt');
    strategy.withSalt(options.salt);
  }
  if (options.feeBps !== undefined) {
    if (!Number.isInteger(options.feeBps) || options.feeBps < 0 || options.feeBps > 10_000) {
      throw new Error('Fee must be an integer from 0 to 10000 basis points');
    }
    strategy.withFeeTokenIn(options.feeBps);
  }
  return Order.new({ maker: new Address(address(maker)), traits: MakerTraits.default(), program: strategy.build() });
}

/** Preserve the caller's token orientation: token0 atomic units buy numerator/denominator token1 units. */
export function encodeFixedRateArgs(
  token0: Hex, token1: Hex, numerator: bigint, denominator: bigint,
): Hex {
  const [first, second] = pair(token0, token1);
  positive(numerator, 'Numerator');
  positive(denominator, 'Denominator');
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
    [first, second, numerator, denominator],
  );
}

export function buildExtructionOrder(
  maker: Hex, target: Hex, token0: Hex, token1: Hex, numerator: bigint, denominator: bigint,
): Order {
  const args = new HexString(encodeFixedRateArgs(token0, token1, numerator, denominator));
  const program = new AquaProgramBuilder().add(instructions.extruction.extruction.createIx(
    new instructions.extruction.ExtructionArgs(new Address(address(target)), args),
  )).build();
  return Order.new({ maker: new Address(address(maker)), traits: MakerTraits.default(), program });
}

/** CustomAquaRouter appends opcode 34 (0x22); the ABI pricing payload is exactly 128 bytes. */
export function buildCustomOpcodeOrder(
  maker: Hex, token0: Hex, token1: Hex, numerator: bigint, denominator: bigint,
): Order {
  const program = new SwapVmProgram(concatHex(['0x2280', encodeFixedRateArgs(token0, token1, numerator, denominator)]));
  return Order.new({ maker: new Address(address(maker)), traits: MakerTraits.default(), program });
}

/** Sort tokens and keep each amount attached to its token; duplicate token allocations are rejected. */
function allocations(values: TokenAllocation[]) {
  if (values.length === 0) throw new Error('At least one token allocation is required');
  const sorted = values.map(({ token, amount }) => {
    positive(amount, 'Allocation');
    return { token: address(token), amount };
  }).sort((a, b) => BigInt(a.token) < BigInt(b.token) ? -1 : 1);
  if (new Set(sorted.map(({ token }) => token)).size !== sorted.length) throw new Error('Duplicate token allocation');
  return sorted.map(({ token, amount }) => ({ token: new AquaAddress(token), amount }));
}

/** Shipping creates virtual balances. Maker ERC20 approvals must target Aqua, not the app. */
export function encodeShip(order: Order, values: TokenAllocation[], chainId: SupportedChainId = 137) {
  return encodeShipToApp(order, values, getOfficialDeployments(chainId).router, chainId);
}

/** A custom app/router remains backed by the official Aqua registry. */
export function encodeShipToApp(
  order: Order, values: TokenAllocation[], app: Hex, chainId: SupportedChainId = 137,
) {
  const { aqua } = getOfficialDeployments(chainId);
  return new AquaProtocolContract(new AquaAddress(aqua)).ship({
    app: new AquaAddress(address(app)),
    strategy: new AquaHexString(order.encode().toString()),
    amountsAndTokens: allocations(values),
  });
}

export function encodeDock(order: Order, tokens: Hex[], chainId: SupportedChainId = 137) {
  return encodeDockFromApp(order, tokens, getOfficialDeployments(chainId).router, chainId);
}

export function encodeDockFromApp(order: Order, tokens: Hex[], app: Hex, chainId: SupportedChainId = 137) {
  const { aqua } = getOfficialDeployments(chainId);
  const sorted = allocations(tokens.map((token) => ({ token, amount: 1n })));
  return new AquaProtocolContract(new AquaAddress(aqua)).dock({
    app: new AquaAddress(address(app)),
    strategyHash: new AquaHexString(order.hash().toString()),
    tokens: sorted.map(({ token }) => token),
  });
}

function swapArgs(params: SwapParameters) {
  const [tokenIn, tokenOut] = pair(params.tokenIn, params.tokenOut);
  positive(params.amount, 'Swap amount');
  if (params.threshold !== undefined && (params.threshold < 0n || params.threshold > UINT256_MAX)) {
    throw new Error('Threshold must be a uint256');
  }
  if (params.deadline !== undefined && (params.deadline < 0n || params.deadline >= (1n << 40n))) {
    throw new Error('Deadline must be a uint40');
  }
  return {
    order: params.order,
    tokenIn: new Address(tokenIn),
    tokenOut: new Address(tokenOut),
    amount: params.amount,
    takerTraits: TakerTraits.new({
      exactIn: params.exactIn ?? true,
      threshold: params.threshold ?? 0n,
      strictThreshold: params.strictThreshold ?? false,
      deadline: params.deadline ?? 0n,
      useTransferFromAndAquaPush: true,
    }),
  };
}

export function encodeQuote(params: SwapParameters, chainId: SupportedChainId = 137) {
  return encodeQuoteAtRouter(params, getOfficialDeployments(chainId).router, chainId);
}

/** Explicit custom-router variant; the demo verifies its AQUA() points to the official registry. */
export function encodeQuoteAtRouter(params: SwapParameters, router: Hex, chainId: SupportedChainId = 137) {
  getOfficialDeployments(chainId);
  return new SwapVMContract(new Address(address(router))).quote(swapArgs(params));
}

/** Takers approve the router. Require explicit slippage protection on every swap. */
export function encodeSwap(params: SwapParameters, chainId: SupportedChainId = 137) {
  return encodeSwapAtRouter(params, getOfficialDeployments(chainId).router, chainId);
}

export function encodeSwapAtRouter(params: SwapParameters, router: Hex, chainId: SupportedChainId = 137) {
  getOfficialDeployments(chainId);
  if (params.threshold === undefined || params.threshold <= 0n) throw new Error('Swap requires a positive threshold');
  return new SwapVMContract(new Address(address(router))).swap(swapArgs(params));
}
