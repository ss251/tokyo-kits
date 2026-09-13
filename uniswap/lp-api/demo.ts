import addresses from '../addresses.json';
import { address, requireApiKey, type Address, type ApiOptions } from '../api-swap/client';
import { requestCreate, requestIncrease, requestDecrease, type CommonRequest, type PositionReference, type LPToken } from './client';

export interface LpDemoContext extends ApiOptions {
  walletAddress: Address;
  /** Existing public-chain NFT owned by walletAddress, independently verified by the executor. */
  position: PositionReference & { protocol: CommonRequest['protocol'] };
  independentToken: LPToken;
}

/** These are unsigned payloads, never receipts. Public API cannot see fork-created NFT state. */
export async function runLpApi(context: LpDemoContext) {
  requireApiKey('lp');
  if (!context.position) throw new Error('NOT PROVEN: LP management needs an existing public-chain position and its verified owner');
  const shared = { walletAddress: context.walletAddress, chainId: addresses.chainId,
    slippageTolerance: 0.5, simulateTransaction: false };
  const create = await requestCreate({ ...shared, protocol: 'V3', existingPool: {
    token0Address: address(addresses.weth, 'WETH'), token1Address: address(addresses.usdc, 'USDC'),
    poolReference: address(addresses.v3Pool, 'V3 pool'),
  }, independentToken: { tokenAddress: address(addresses.weth, 'WETH'), amount: '1000000000000000' },
  tickBounds: { tickLower: -887270, tickUpper: 887270 } }, context);
  const management = { ...shared, ...context.position };
  const increase = await requestIncrease({ ...management, independentToken: context.independentToken }, context);
  const decrease = await requestDecrease({ ...management, liquidityPercentageToDecrease: 1 }, context);
  return { create, increase, decrease };
}
