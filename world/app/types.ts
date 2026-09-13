import type { Address, Hex } from 'viem';
import type { WorldEnvironment } from '../world-id-verify/server/config';

export interface PublicConfig {
  miniAppId: string | null;
  worldIdAppId: string | null;
  worldIdReady: boolean;
  missingWorldId: string[];
  environment: WorldEnvironment;
  origin: string;
  pingAddress: Address | null;
  pingReady: boolean;
  chainId: 480;
}
export interface SessionState { wallet: Address; humanVerified: boolean; expiresAt: number }
export interface PingCall { to: Address; data: Hex; value: '0x0'; note: Hex; chainId: 480 }
export interface PingReceipt {
  status: 'confirmed'; transactionHash: Hex; blockNumber: string;
  sender: Address; contract: Address; note: Hex; chainId: 480;
}
