// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { database, session, verifiedSession } from './wallet-auth';
import type { VerifiedIdentity } from '../../world-id-verify/server/verify';

const variables = ['WORLD_ID_APP_ID', 'WORLD_RP_ID', 'WORLD_RP_SIGNING_KEY', 'WORLD_ID_ACTION', 'WORLD_ID_ENVIRONMENT',
  'WORLD_APP_ORIGIN', 'WORLD_ID_TTL_SECONDS', 'WORLD_CHAIN_RPC_URL', 'WORLD_WALLET_DATABASE'] as const;
let original: Record<string, string | undefined>;
let directory: string;
let fixtureIdentity: VerifiedIdentity;
const globals = globalThis as typeof globalThis & { tokyoWalletDb?: DatabaseSync };

function disconnectDatabase() {
  globals.tokyoWalletDb?.close();
  delete globals.tokyoWalletDb;
}

beforeEach(() => {
  original = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  directory = mkdtempSync(join(tmpdir(), 'world-wallet-session-'));
  Object.assign(process.env, {
    WORLD_ID_APP_ID: 'app_session_fixture', WORLD_RP_ID: 'rp_0000000000000001', WORLD_RP_SIGNING_KEY: generatePrivateKey(),
    WORLD_ID_ACTION: 'session-scope-fixture', WORLD_ID_ENVIRONMENT: 'staging', WORLD_APP_ORIGIN: 'http://localhost:3000',
    WORLD_ID_TTL_SECONDS: '300', WORLD_CHAIN_RPC_URL: 'http://127.0.0.1:8545', WORLD_WALLET_DATABASE: join(directory, 'wallet.sqlite'),
  });
  // Trusted server-function input fixture; no World proof or API acceptance is claimed.
  fixtureIdentity = { verified: true, verifier: 'https://developer.world.org/api/v4/verify',
    wallet: privateKeyToAccount(generatePrivateKey()).address, nullifier: '171', action: 'session-scope-fixture',
    rpId: 'rp_0000000000000001', environment: 'staging', challengeId: 'session-fixture', verifiedAt: Math.floor(Date.now() / 1000) };
});

afterEach(() => {
  disconnectDatabase();
  for (const name of variables) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  rmSync(directory, { recursive: true, force: true });
});

describe('persistent human session scope (trusted identity fixture; real SQLite)', () => {
  test('preserves a verified session across a database reopen with the same configuration', () => {
    const authenticated = verifiedSession(fixtureIdentity);
    assert.equal(session(authenticated.token, true).humanVerified, true);
    disconnectDatabase();
    const restored = session(authenticated.token, true);
    assert.equal(restored.humanVerified, true);
    assert.equal(restored.wallet, fixtureIdentity.wallet);
    assert.equal(restored.expiresAt, authenticated.session.expiresAt);
  });

  for (const [name, replacement] of [
    ['WORLD_ID_ENVIRONMENT', 'production'], ['WORLD_ID_ACTION', 'different-action'], ['WORLD_APP_ORIGIN', 'https://another.example'],
    ['WORLD_ID_APP_ID', 'app_another_fixture'], ['WORLD_RP_ID', 'rp_0000000000000002'],
  ] as const) {
    test(`a persisted verified session cannot authorize after ${name} changes`, () => {
      const authenticated = verifiedSession(fixtureIdentity);
      const previous = process.env[name];
      disconnectDatabase();
      process.env[name] = replacement;
      assert.equal(session(authenticated.token).humanVerified, false);
      assert.throws(() => session(authenticated.token, true), /world_id_verification_required/);
      process.env[name] = previous;
      assert.equal(session(authenticated.token, true).humanVerified, true);
    });
  }

  test('missing required RP configuration cannot authorize a previously verified session', () => {
    const authenticated = verifiedSession(fixtureIdentity);
    disconnectDatabase();
    delete process.env.WORLD_RP_SIGNING_KEY;
    assert.equal(session(authenticated.token).humanVerified, false);
    assert.throws(() => session(authenticated.token, true), /world_id_verification_required/);
  });

  test('migrates legacy boolean-only sessions without granting human authorization', () => {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const legacy = new DatabaseSync(process.env.WORLD_WALLET_DATABASE!);
    legacy.exec('CREATE TABLE wallet_sessions(token_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, human_verified INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
    legacy.prepare('INSERT INTO wallet_sessions VALUES (?, ?, ?, ?)').run(tokenHash, fixtureIdentity.wallet, 1, Math.floor(Date.now() / 1000) + 3600);
    legacy.close();
    assert.equal(session(token).humanVerified, false);
    assert.throws(() => session(token, true), /world_id_verification_required/);
    const columns = database().prepare('PRAGMA table_info(wallet_sessions)').all() as { name: string }[];
    assert.ok(columns.some((column) => column.name === 'identity_scope'));
    disconnectDatabase();
    assert.equal(session(token).humanVerified, false);
    assert.throws(() => session(token, true), /world_id_verification_required/);
  });
});
