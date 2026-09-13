// SPDX-License-Identifier: MIT
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { worldchain } from 'viem/chains';
import { buildChallenge, type Challenge } from './challenge';
import { validateWorldIdConfig, type WorldIdConfig } from './config';
import { WorldIdError, WorldIdStore } from './store';

export interface VerifyInput { challengeId: string; walletSignature: Hex; result: unknown }
export interface VerifiedIdentity {
  verified: true;
  verifier: 'https://developer.world.org/api/v4/verify';
  wallet: Address;
  nullifier: string;
  action: string;
  rpId: string;
  environment: Challenge['environment'];
  challengeId: string;
  verifiedAt: number;
}
export type WalletSignatureVerifier = (request: { address: Address; message: string; signature: Hex }) => Promise<boolean>;
export interface ServiceOptions {
  /** Production uses World Chain ERC-1271/ERC-6492-capable verification. Override only in tests. */
  verifyWalletSignature?: WalletSignatureVerifier;
  /** Test-only injection point. The production endpoint itself cannot be configured. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new WorldIdError('malformed_proof', 400);
  return value as Record<string, unknown>;
}
export function uint256Hex(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new WorldIdError('malformed_uint256', 400);
  return BigInt(value);
}

/** These checks enforce application policy; they do not verify a World ID ZK proof. */
function validateProof(result: unknown, challenge: Challenge): string {
  const root = object(result);
  if (root.protocol_version !== '4.0' || 'session_id' in root) throw new WorldIdError('uniqueness_v4_required', 400);
  if (root.action !== challenge.action || root.environment !== challenge.environment || uint256Hex(root.nonce) !== uint256Hex(challenge.rp_context.nonce)) {
    throw new WorldIdError('proof_scope_mismatch', 400);
  }
  if (!Array.isArray(root.responses) || root.responses.length !== 1) throw new WorldIdError('single_human_credential_required', 400);
  const credential = object(root.responses[0]);
  if (credential.identifier !== 'proof_of_human' || credential.issuer_schema_id !== 1) throw new WorldIdError('human_credential_required', 400);
  if (credential.expires_at_min !== challenge.expiresAtMin) throw new WorldIdError('credential_expiry_constraint_mismatch', 400);
  if (uint256Hex(credential.signal_hash) !== uint256Hex(challenge.signalHash)) throw new WorldIdError('wallet_signal_mismatch', 400);
  if (!Array.isArray(credential.proof) || credential.proof.length !== 5) throw new WorldIdError('five_word_proof_required', 400);
  for (const word of credential.proof) uint256Hex(word);
  return uint256Hex(credential.nullifier).toString(10);
}

export function createWorldIdService(inputConfig: Readonly<WorldIdConfig>, store: WorldIdStore, options: ServiceOptions = {}) {
  const config = validateWorldIdConfig(inputConfig);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const transport = options.fetch ?? globalThis.fetch;
  const client = createPublicClient({ chain: worldchain, transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) });
  const checkWallet: WalletSignatureVerifier = options.verifyWalletSignature ?? (async (request) => {
    if (await client.getChainId() !== 480) throw new WorldIdError('wrong_wallet_verification_chain', 503);
    return client.verifyMessage(request);
  });
  return {
    challenge(wallet: unknown): Challenge {
      let challenge: Challenge;
      try { challenge = buildChallenge(config, wallet); }
      catch { throw new WorldIdError('invalid_challenge_request', 400); }
      store.add(challenge);
      return challenge;
    },
    async verify(input: VerifyInput): Promise<VerifiedIdentity> {
      if (typeof input?.challengeId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.challengeId)) throw new WorldIdError('invalid_challenge_id', 400);
      if (typeof input.walletSignature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,8192}$/.test(input.walletSignature)) throw new WorldIdError('invalid_wallet_signature', 400);
      const challenge = store.get(input.challengeId, now());
      if (challenge.app_id !== config.appId || challenge.action !== config.action || challenge.environment !== config.environment || challenge.rp_context.rp_id !== config.rpId || challenge.origin !== config.origin) {
        throw new WorldIdError('challenge_configuration_changed', 409);
      }
      // Snapshot before any await: callers cannot swap a checked payload during network I/O.
      let body: string;
      try { body = JSON.stringify(input.result); }
      catch { throw new WorldIdError('malformed_proof', 400); }
      if (!body || body.length > 65_536) throw new WorldIdError('proof_too_large', 400);
      const nullifier = validateProof(JSON.parse(body), challenge);
      let walletValid: boolean;
      try { walletValid = await checkWallet({ address: challenge.wallet, message: challenge.walletMessage, signature: input.walletSignature }); }
      catch { throw new WorldIdError('wallet_verification_unavailable', 503); }
      if (!walletValid) throw new WorldIdError('wallet_signature_rejected', 401);
      const endpoint = `https://developer.world.org/api/v4/verify/${config.rpId}`;
      let response: Response;
      try {
        response = await transport(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body,
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      } catch { throw new WorldIdError('world_verification_unavailable', 503); }
      // The official v4 integration contract defines HTTP success as a valid proof.
      // Explicit failure bodies are also rejected, even if an upstream incorrectly uses 2xx.
      if (!response.ok) {
        await response.body?.cancel();
        throw new WorldIdError(response.status >= 500 || response.status === 429 ? 'world_verification_unavailable' : 'world_proof_rejected', response.status >= 500 || response.status === 429 ? 503 : 400);
      }
      let text: string;
      try { text = await response.text(); }
      catch { throw new WorldIdError('world_verification_unavailable', 503); }
      if (text.length > 65_536) throw new WorldIdError('invalid_world_verification_response', 502);
      if (text.trim()) {
        let payload: Record<string, unknown>;
        try { payload = object(JSON.parse(text)); }
        catch { throw new WorldIdError('invalid_world_verification_response', 502); }
        if (payload.success === false || payload.verified === false || payload.error || payload.code) throw new WorldIdError('world_proof_rejected', 400);
      }
      const verifiedAt = now();
      store.consume(challenge, nullifier, verifiedAt);
      return { verified: true, verifier: 'https://developer.world.org/api/v4/verify', wallet: challenge.wallet, nullifier,
        action: challenge.action, rpId: config.rpId, environment: challenge.environment, challengeId: challenge.challengeId, verifiedAt };
    },
  };
}

export type WorldIdService = ReturnType<typeof createWorldIdService>;
