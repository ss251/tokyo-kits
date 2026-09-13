import type { Address, Hex } from 'viem';

export interface AppConfig { label: string; recipient: Address; enabled: boolean; limit: number }
export interface Resolution {
  source: 'ens' | 'literal';
  config: AppConfig;
  evidence: null | { name: string; resolver: Address; universalResolver: Address; chainId: 11155111; blockNumber: string; blockHash: Hex; blockTimestamp: string; readAt: string };
}
export interface LabSettings { initialName: string; chainId: 11155111; universalResolver: Address; transport: 'public RPC' | 'configured server RPC' }
