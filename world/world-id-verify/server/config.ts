// SPDX-License-Identifier: MIT
import { resolve } from 'node:path';

export type WorldEnvironment = 'production' | 'staging' | 'sandbox';
export interface WorldIdConfig {
  appId: `app_${string}`;
  rpId: string;
  signingKeyHex: string;
  action: string;
  environment: WorldEnvironment;
  origin: string;
  ttlSeconds: number;
  databasePath: string;
  rpcUrl: string;
}

export function rpIdToUint64(rpId: string): bigint {
  if (!/^rp_[0-9a-fA-F]{1,16}$/.test(rpId)) throw new Error('World RP ID must contain 1–16 hexadecimal digits after rp_');
  return BigInt(`0x${rpId.slice(3)}`);
}

export function validateWorldIdConfig(input: WorldIdConfig): Readonly<WorldIdConfig> {
  if (!/^app_[0-9a-zA-Z_-]+$/.test(input.appId)) throw new Error('Configure WORLD_ID_APP_ID');
  const numericRpId = rpIdToUint64(input.rpId);
  if (numericRpId === 0n) throw new Error('WORLD_RP_ID must identify a registered, nonzero RP');
  const rpId = `rp_${numericRpId.toString(16).padStart(16, '0')}`;
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(input.signingKeyHex)) throw new Error('Configure server-only WORLD_RP_SIGNING_KEY');
  if (!input.action || input.action.length > 128 || /[\r\n\x00-\x1f]/.test(input.action)) throw new Error('Configure a fixed WORLD_ID_ACTION (1–128 printable characters)');
  if (!['production', 'staging', 'sandbox'].includes(input.environment)) throw new Error('Invalid WORLD_ID_ENVIRONMENT');
  const origin = new URL(input.origin);
  if (origin.origin !== input.origin || origin.username || origin.password ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('WORLD_APP_ORIGIN must be an HTTPS origin, or loopback HTTP for development');
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 900) throw new Error('WORLD_ID_TTL_SECONDS must be 60–900');
  const rpc = new URL(input.rpcUrl);
  if (!['http:', 'https:'].includes(rpc.protocol)) throw new Error('Invalid World Chain RPC URL');
  return Object.freeze({ ...input, rpId });
}

/** Call only in a Node server module; this return value contains the RP signing key. */
export function loadWorldIdConfig(env: Record<string, string | undefined> = process.env): Readonly<WorldIdConfig> {
  return validateWorldIdConfig({
    appId: (env.WORLD_ID_APP_ID ?? '') as `app_${string}`,
    rpId: env.WORLD_RP_ID ?? '',
    signingKeyHex: env.WORLD_RP_SIGNING_KEY ?? '',
    action: env.WORLD_ID_ACTION ?? 'tokyo-kits-verify',
    environment: (env.WORLD_ID_ENVIRONMENT ?? 'staging') as WorldEnvironment,
    origin: env.WORLD_APP_ORIGIN ?? 'http://localhost:3000',
    ttlSeconds: Number(env.WORLD_ID_TTL_SECONDS ?? '300'),
    databasePath: resolve(env.WORLD_ID_DATABASE ?? '.run/world-id.sqlite'),
    rpcUrl: env.WORLD_CHAIN_RPC_URL ?? 'https://worldchain-mainnet.g.alchemy.com/public',
  });
}
