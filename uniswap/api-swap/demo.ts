import addresses from '../addresses.json';
import { address, prepareSwap, requireApiKey, type Address, type SwapOptions } from './client';

/** Prepare only. The shared demo runner executes and records the transaction separately. */
export async function runApiSwap(context: { walletAddress: Address } & SwapOptions) {
  requireApiKey();
  return prepareSwap({
    type: 'EXACT_INPUT', amount: '1000000000000000',
    tokenInChainId: addresses.chainId, tokenOutChainId: addresses.chainId,
    tokenIn: address(addresses.weth, 'WETH'), tokenOut: address(addresses.usdc, 'USDC'),
    swapper: context.walletAddress, recipient: context.walletAddress,
    slippageTolerance: 0.5, protocols: ['V3', 'V4'], hooksOptions: 'V4_NO_HOOKS',
  }, context);
}
