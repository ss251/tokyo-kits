// SPDX-License-Identifier: MIT
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRpSignatureMessage } from '@worldcoin/idkit-server';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { hexToBytes, keccak256, stringToBytes, toBytes, verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { validateWorldIdConfig, rpIdToUint64, type WorldIdConfig } from '../server/config';
import { WorldIdStore } from '../server/store';
import { createWorldIdService } from '../server/verify';

const stores: WorldIdStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });

function setup() {
  const signingKeyHex = generatePrivateKey();
  const config: WorldIdConfig = {
    appId: 'app_test_fixture', rpId: 'rp_0000000000000010', signingKeyHex,
    action: 'tokyo-kits-verify', environment: 'staging', origin: 'http://localhost:3000',
    ttlSeconds: 300, databasePath: ':memory:', rpcUrl: 'http://127.0.0.1:8545',
  };
  const store = new WorldIdStore(':memory:'); stores.push(store);
  return { config, service: createWorldIdService(config, store), account: privateKeyToAccount(signingKeyHex) };
}

describe('World ID RP challenge', () => {
  test('official SDK signs the fixed action, nonce and exact expiry with the configured server key', async () => {
    const { service, config, account } = setup();
    const wallet = privateKeyToAccount(generatePrivateKey());
    const challenge = service.challenge(wallet.address.toLowerCase());
    const context = challenge.rp_context;
    const message = computeRpSignatureMessage(hexToBytes(context.nonce as `0x${string}`), context.created_at, context.expires_at, config.action);
    assert.equal(await verifyMessage({ address: account.address, message: { raw: message }, signature: context.signature as `0x${string}` }), true);
    const altered = computeRpSignatureMessage(hexToBytes(context.nonce as `0x${string}`), context.created_at, context.expires_at, 'another-action');
    assert.equal(await verifyMessage({ address: account.address, message: { raw: altered }, signature: context.signature as `0x${string}` }), false);
    assert.equal(context.expires_at - context.created_at, 300);
    assert.equal(challenge.expiresAtMin, context.expires_at);
    assert.equal(challenge.wallet, wallet.address);
    assert.ok(!JSON.stringify(challenge).includes(config.signingKeyHex));
    assert.ok(challenge.walletMessage.includes(config.origin));
    assert.ok(challenge.walletMessage.includes(context.nonce));
  });

  test('wallet signal hashes the packed address, while action hashes UTF-8, both shifted eight bits', () => {
    const { service } = setup();
    const wallet = privateKeyToAccount(generatePrivateKey());
    const challenge = service.challenge(wallet.address);
    assert.equal(BigInt(challenge.signalHash), BigInt(keccak256(wallet.address)) >> 8n);
    assert.equal(challenge.signalHash, hashSignal(hexToBytes(wallet.address)));
    assert.equal(BigInt(hashSignal(toBytes(challenge.action))), BigInt(keccak256(toBytes(challenge.action))) >> 8n);
    assert.notEqual(BigInt(hashSignal(stringToBytes(wallet.address))), BigInt(challenge.signalHash));
  });

  test('uses unpredictable independent nonces and limits outstanding requests for one wallet', () => {
    const { service } = setup();
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const challenges = Array.from({ length: 5 }, () => service.challenge(wallet));
    assert.equal(new Set(challenges.map((challenge) => challenge.rp_context.nonce)).size, 5);
    assert.equal(new Set(challenges.map((challenge) => challenge.challengeId)).size, 5);
    assert.throws(() => service.challenge(wallet), new RegExp('too_many_active_challenges'));
  });

  test('parses RP identifiers as uint64 hexadecimal and rejects invalid server configuration', () => {
    const { config } = setup();
    assert.equal(rpIdToUint64('rp_10'), 16n);
    assert.equal(rpIdToUint64('rp_FFFFFFFFFFFFFFFF'), (1n << 64n) - 1n);
    assert.equal(validateWorldIdConfig({ ...config, rpId: 'rp_A' }).rpId, 'rp_000000000000000a');
    for (const rpId of ['rp_', '10', 'rp_10000000000000000', 'rp_-1', 'rp_g']) assert.throws(() => rpIdToUint64(rpId));
    for (const ttlSeconds of [59, 901, 60.5, NaN]) assert.throws(() => validateWorldIdConfig({ ...config, ttlSeconds }));
    for (const origin of ['http://example.com', 'https://example.com/path', 'https://example.com/', 'https://user:pass@example.com']) {
      assert.throws(() => validateWorldIdConfig({ ...config, origin }));
    }
    assert.throws(() => validateWorldIdConfig({ ...config, signingKeyHex: '' }));
    assert.throws(() => validateWorldIdConfig({ ...config, rpId: 'rp_0' }));
    assert.throws(() => validateWorldIdConfig({ ...config, action: 'one\ntwo' }));
  });
});
