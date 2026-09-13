// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { signRequest } from '@worldcoin/idkit-server';
import type { RpContext } from '@worldcoin/idkit-core';
import { getAddress, hexToBytes, isAddress, type Address, type Hex } from 'viem';
import type { WorldEnvironment, WorldIdConfig } from './config';

export interface Challenge {
  challengeId: string;
  app_id: `app_${string}`;
  action: string;
  environment: WorldEnvironment;
  origin: string;
  allow_legacy_proofs: false;
  rp_context: RpContext;
  wallet: Address;
  walletMessage: string;
  /** Hex-encoded 20 bytes, never the UTF-8 text of an address. */
  signal: Address;
  signalHash: Hex;
  expiresAtMin: number;
  genesisIssuedAtMin: 0;
  issuerSchemaId: 1;
}

export function buildChallenge(config: Readonly<WorldIdConfig>, walletInput: unknown): Challenge {
  if (typeof walletInput !== 'string' || !isAddress(walletInput, { strict: false })) throw new Error('Invalid wallet address');
  const wallet = getAddress(walletInput);
  const signed = signRequest({ signingKeyHex: config.signingKeyHex, action: config.action, ttl: config.ttlSeconds });
  const challengeId = randomUUID();
  const walletMessage = [
    'Authorize this World ID verification request.',
    `Origin: ${config.origin}`, `Wallet: ${wallet}`, 'Chain ID: 480',
    `App: ${config.appId}`, `RP: ${config.rpId}`, `Environment: ${config.environment}`,
    `Action: ${config.action}`, `Challenge: ${challengeId}`, `Nonce: ${signed.nonce}`,
    `Issued at: ${signed.createdAt}`, `Expires at: ${signed.expiresAt}`,
    'This signature does not transfer assets.',
  ].join('\n');
  return {
    challengeId, app_id: config.appId, action: config.action, environment: config.environment, origin: config.origin,
    allow_legacy_proofs: false, wallet, walletMessage, signal: wallet,
    signalHash: hashSignal(hexToBytes(wallet)) as Hex,
    rp_context: { rp_id: config.rpId, nonce: signed.nonce, created_at: signed.createdAt, expires_at: signed.expiresAt, signature: signed.sig },
    expiresAtMin: signed.expiresAt, genesisIssuedAtMin: 0, issuerSchemaId: 1,
  };
}
