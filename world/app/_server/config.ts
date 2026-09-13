import { isAddress, type Address } from 'viem';
import { loadWorldIdConfig } from '../../world-id-verify/server/config';
import type { PublicConfig } from '../types';

export function appOrigin(): string {
  const value = process.env.WORLD_APP_ORIGIN ?? 'http://localhost:3000';
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Invalid WORLD_APP_ORIGIN');
  }
  return value;
}
export function publicConfig(): PublicConfig {
  const required = ['WORLD_ID_APP_ID', 'WORLD_RP_ID', 'WORLD_RP_SIGNING_KEY'];
  const missingWorldId = required.filter(name => !process.env[name]?.trim());
  let worldIdReady = false;
  try { loadWorldIdConfig(); worldIdReady = true; } catch { if (!missingWorldId.length) missingWorldId.push('World ID configuration is invalid'); }
  const mini = process.env.WORLD_MINIKIT_APP_ID;
  const miniAppId = mini && /^app_[a-zA-Z0-9_-]+$/.test(mini) ? mini : null;
  const ping = process.env.WORLD_PING_ADDRESS;
  const pingAddress = ping && isAddress(ping, { strict: false }) && BigInt(ping) !== 0n ? ping as Address : null;
  const environment = process.env.WORLD_ID_ENVIRONMENT;
  return { miniAppId, worldIdAppId: process.env.WORLD_ID_APP_ID || null, worldIdReady, missingWorldId,
    environment: environment === 'production' || environment === 'sandbox' ? environment : 'staging',
    origin: appOrigin(), pingAddress, pingReady: !!miniAppId && !!pingAddress && process.env.WORLD_PING_ALLOWLIST_CONFIRMED === 'true', chainId: 480 };
}
export function rpcUrl() { return process.env.WORLD_CHAIN_RPC_URL ?? 'https://worldchain-mainnet.g.alchemy.com/public'; }
