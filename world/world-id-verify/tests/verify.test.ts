// SPDX-License-Identifier: MIT
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Challenge } from '../server/challenge';
import type { WorldIdConfig } from '../server/config';
import { WorldIdStore } from '../server/store';
import { createWorldIdService, type VerifyInput, type ServiceOptions } from '../server/verify';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

/** Deliberately invalid cryptographic proof: only the World HTTP boundary is mocked. */
function fixture(challenge: Challenge, nullifier = '0xab') {
  return { protocol_version: '4.0', nonce: challenge.rp_context.nonce, action: challenge.action,
    environment: challenge.environment, responses: [{ identifier: 'proof_of_human', signal_hash: challenge.signalHash,
      proof: ['0x01', '0x02', '0x03', '0x04', '0x05'], nullifier, issuer_schema_id: 1, expires_at_min: challenge.expiresAtMin }] };
}

function setup(options: ServiceOptions = {}, path = ':memory:') {
  const config: WorldIdConfig = { appId: 'app_test_fixture', rpId: 'rp_0000000000000001', signingKeyHex: generatePrivateKey(),
    action: 'tokyo-kits-verify', environment: 'staging', origin: 'http://localhost:3000', ttlSeconds: 300, databasePath: path, rpcUrl: 'http://127.0.0.1:8545' };
  const store = new WorldIdStore(path);
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } }; cleanup.push(close);
  const wallet = privateKeyToAccount(generatePrivateKey());
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: NonNullable<ServiceOptions['fetch']> = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ success: true });
  };
  const deps: ServiceOptions = { verifyWalletSignature: (request) => verifyMessage(request), fetch: fakeFetch, ...options };
  const service = createWorldIdService(config, store, deps);
  const request = async (nullifier = '0xab') => {
    const challenge = service.challenge(wallet.address);
    const input: VerifyInput = { challengeId: challenge.challengeId, walletSignature: await wallet.signMessage({ message: challenge.walletMessage }), result: fixture(challenge, nullifier) };
    return { challenge, input };
  };
  return { config, store, close, wallet, calls, deps, service, request };
}

describe('World ID server policy and persistent replay protection (mock World HTTP only)', () => {
  test('forwards the unchanged checked result to the fixed RP endpoint then consumes once', async () => {
    const { service, request, calls } = setup();
    const { input } = await request();
    const result = await service.verify(input);
    assert.equal(result.nullifier, '171');
    assert.deepEqual(calls, [{ url: 'https://developer.world.org/api/v4/verify/rp_0000000000000001', body: input.result }]);
    await assert.rejects(service.verify(input), new RegExp('challenge_already_used'));
    assert.equal(calls.length, 1);
  });

  test('rejects another wallet signature before invoking World verification', async () => {
    const { service, request, calls } = setup();
    const { input, challenge } = await request();
    input.walletSignature = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: challenge.walletMessage });
    await assert.rejects(service.verify(input), new RegExp('wallet_signature_rejected'));
    assert.equal(calls.length, 0);
  });

  test('rejects scope, credential and wallet substitutions before any upstream call', async () => {
    const { service, request, calls } = setup();
    const { input } = await request();
    const mutations: Array<(value: ReturnType<typeof fixture> & Record<string, unknown>) => void> = [
      (value) => { value.action = 'different'; }, (value) => { value.environment = 'production'; },
      (value) => { value.nonce = '0x01'; }, (value) => { value.protocol_version = '3.0'; },
      (value) => { value.session_id = 'session_fixture'; }, (value) => { value.responses[0]!.signal_hash = '0x01'; },
      (value) => { value.responses[0]!.identifier = 'passport'; }, (value) => { value.responses[0]!.issuer_schema_id = 9303; },
      (value) => { value.responses[0]!.expires_at_min = 0; }, (value) => { value.responses[0]!.proof.pop(); },
      (value) => { value.responses[0]!.nullifier = '-1'; }, (value) => { value.responses.push(value.responses[0]!); },
    ];
    for (const mutate of mutations) {
      const result = structuredClone(input.result) as ReturnType<typeof fixture> & Record<string, unknown>;
      mutate(result);
      await assert.rejects(service.verify({ ...input, result }));
    }
    assert.equal(calls.length, 0);
  });

  test('normalizes hex nullifier casing and padding across different signed challenges', async () => {
    const { service, request } = setup();
    await service.verify((await request('0xaB')).input);
    await assert.rejects(service.verify((await request('0x00AB')).input), new RegExp('nullifier_already_used'));
  });

  test('preserves replay protection after a real SQLite reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'world-id-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const state = setup({}, join(dir, 'state.sqlite'));
    const { input } = await state.request(); await state.service.verify(input); state.close();
    const reopened = new WorldIdStore(state.config.databasePath); cleanup.push(() => reopened.close());
    const service = createWorldIdService(state.config, reopened, state.deps);
    await assert.rejects(service.verify(input), new RegExp('challenge_already_used'));
    const challenge = service.challenge(state.wallet.address);
    await assert.rejects(service.verify({ challengeId: challenge.challengeId,
      walletSignature: await state.wallet.signMessage({ message: challenge.walletMessage }), result: fixture(challenge, '0x000Ab') }), new RegExp('nullifier_already_used'));
  });

  test('allows only one winner when two valid responses race for one challenge', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let arrived = 0;
    const { service, request } = setup({ fetch: async () => { if (++arrived === 2) release(); await barrier; return Response.json({ success: true }); } });
    const { input } = await request();
    const outcomes = await Promise.allSettled([service.verify(input), service.verify(input)]);
    assert.equal(outcomes.filter((value) => value.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((value) => value.status === 'rejected').length, 1);
  });

  test('does not consume on World HTTP failure or explicit failure in a success HTTP response', async () => {
    for (const response of [() => new Response('rejected', { status: 400 }), () => new Response('unavailable', { status: 503 }),
      () => Response.json({ success: false }), () => new Response('<html>bad proxy</html>', { status: 200 })]) {
      let fail = true;
      const { service, request } = setup({ fetch: async () => fail ? response() : Response.json({ success: true }) });
      const { input } = await request();
      await assert.rejects(service.verify(input));
      fail = false;
      assert.equal((await service.verify(input)).verified, true);
    }
  });

  test('fails closed on wallet RPC and World transport outages without consuming challenge', async () => {
    let worldAvailable = false;
    const state = setup({ fetch: async () => { if (!worldAvailable) throw new Error('offline'); return Response.json({ success: true }); } });
    const { input } = await state.request();
    await assert.rejects(state.service.verify(input), new RegExp('world_verification_unavailable'));
    const unavailableWallet = createWorldIdService(state.config, state.store, { ...state.deps, verifyWalletSignature: async () => { throw new Error('RPC down'); } });
    await assert.rejects(unavailableWallet.verify(input), new RegExp('wallet_verification_unavailable'));
    worldAvailable = true;
    assert.equal((await state.service.verify(input)).verified, true);
  });

  test('rejects at exact challenge expiry and rechecks expiry after the network round trip', async () => {
    let now = Math.floor(Date.now() / 1000);
    let expires = now;
    const { service, request } = setup({ now: () => now, fetch: async () => { now = expires; return Response.json({ success: true }); } });
    const { input, challenge } = await request(); expires = challenge.rp_context.expires_at;
    await assert.rejects(service.verify(input), new RegExp('challenge_expired'));
    await assert.rejects(service.verify(input), new RegExp('challenge_expired'));
  });

  test('snapshots the proof before asynchronous wallet verification', async () => {
    let resume!: () => void;
    const barrier = new Promise<void>((resolve) => { resume = resolve; });
    const state = setup({ verifyWalletSignature: async (request) => { await barrier; return verifyMessage(request); } });
    const { input } = await state.request();
    const result = input.result as ReturnType<typeof fixture>;
    const pending = state.service.verify(input);
    result.responses[0]!.nullifier = '0x999'; result.action = 'tampered'; resume();
    const accepted = await pending;
    assert.equal(accepted.nullifier, '171');
    assert.equal((state.calls[0]!.body as ReturnType<typeof fixture>).action, 'tokyo-kits-verify');
  });

  test('invalidates existing challenges when the configured app origin changes', async () => {
    const state = setup(); const { input } = await state.request();
    const moved = createWorldIdService({ ...state.config, origin: 'https://another.example' }, state.store, state.deps);
    await assert.rejects(moved.verify(input), new RegExp('challenge_configuration_changed'));
  });

  test('changing only the Portal app ID cannot reset RP/action uniqueness', async () => {
    const state = setup(); await state.service.verify((await state.request()).input);
    const moved = createWorldIdService({ ...state.config, appId: 'app_another_fixture' }, state.store, state.deps);
    const challenge = moved.challenge(state.wallet.address);
    await assert.rejects(moved.verify({ challengeId: challenge.challengeId,
      walletSignature: await state.wallet.signMessage({ message: challenge.walletMessage }), result: fixture(challenge, '0xAB') }), /nullifier_already_used/);
  });
});
