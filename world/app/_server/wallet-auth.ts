import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSiweMessage } from '@worldcoin/minikit-js/siwe';
import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { worldchain } from 'viem/chains';
import { WorldIdError } from '../../world-id-verify/server/store';
import { loadWorldIdConfig } from '../../world-id-verify/server/config';
import type { VerifiedIdentity } from '../../world-id-verify/server/verify';
import { appOrigin, rpcUrl } from './config';
import type { SessionState } from '../types';

export const NONCE_COOKIE = 'tokyo-world-nonce';
export const SESSION_COOKIE = 'tokyo-world-session';
export const AUTH_STATEMENT = 'Sign in to the Tokyo Kits World integration lab.';
const now = () => Math.floor(Date.now() / 1000);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const state = globalThis as typeof globalThis & { tokyoWalletDb?: DatabaseSync };
export function database(): DatabaseSync {
  if (!state.tokyoWalletDb) {
    const path = resolve(process.env.WORLD_WALLET_DATABASE ?? '.run/wallet-auth.sqlite');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path); chmodSync(path, 0o600);
    db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS wallet_nonces(id TEXT PRIMARY KEY, nonce TEXT NOT NULL, origin TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);
      CREATE TABLE IF NOT EXISTS wallet_sessions(token_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, human_verified INTEGER NOT NULL, identity_scope TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ping_requests(note TEXT PRIMARY KEY, session_hash TEXT NOT NULL, wallet TEXT NOT NULL, target TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    const columns = db.prepare('PRAGMA table_info(wallet_sessions)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'identity_scope')) db.exec('ALTER TABLE wallet_sessions ADD COLUMN identity_scope TEXT');
    state.tokyoWalletDb = db;
  }
  return state.tokyoWalletDb;
}
export function createNonce() {
  const id = randomBytes(24).toString('hex'); const nonce = randomBytes(24).toString('hex');
  const issuedAt = now(); const expiresAt = issuedAt + 300;
  const db = database();
  db.prepare('DELETE FROM wallet_nonces WHERE expires_at < ?').run(issuedAt - 3600);
  db.prepare('DELETE FROM wallet_sessions WHERE expires_at < ?').run(issuedAt);
  db.prepare('DELETE FROM ping_requests WHERE expires_at < ?').run(issuedAt);
  db.prepare('INSERT INTO wallet_nonces(id,nonce,origin,issued_at,expires_at) VALUES(?,?,?,?,?)').run(id, nonce, appOrigin(), issuedAt, expiresAt);
  return { id, nonce, statement: AUTH_STATEMENT, requestId: id, expirationTime: new Date(expiresAt * 1000).toISOString() };
}
function insertSession(wallet: Address, identityScope: string | null) {
  const token = randomBytes(32).toString('hex'); const expiresAt = now() + 3600;
  database().prepare('INSERT INTO wallet_sessions(token_hash,wallet,human_verified,identity_scope,expires_at) VALUES(?,?,?,?,?)').run(digest(token), wallet, identityScope ? 1 : 0, identityScope, expiresAt);
  return { token, session: { wallet, humanVerified: !!identityScope, expiresAt } satisfies SessionState };
}
/** Mint only after the World ID service verifies both the ZK proof and wallet signature. */
export function verifiedSession(identity: VerifiedIdentity) {
  const config = loadWorldIdConfig();
  const scope = JSON.stringify([identity.environment, identity.rpId, identity.action, config.appId, config.origin]);
  return insertSession(identity.wallet, scope);
}
export function session(token: string | undefined, requireHuman = false): SessionState {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new WorldIdError('wallet_session_required', 401);
  const row = database().prepare('SELECT wallet,human_verified,identity_scope,expires_at FROM wallet_sessions WHERE token_hash = ?').get(digest(token)) as
    { wallet: Address; human_verified: number; identity_scope: string | null; expires_at: number } | undefined;
  if (!row || row.expires_at <= now()) throw new WorldIdError('wallet_session_expired', 401);
  let scopeMatches = false;
  if (row.human_verified) {
    try {
      const config = loadWorldIdConfig();
      scopeMatches = row.identity_scope === JSON.stringify([config.environment, config.rpId, config.action, config.appId, config.origin]);
    } catch { /* Missing or changed config cannot authorize a previously verified session. */ }
  }
  if (requireHuman && !scopeMatches) throw new WorldIdError('world_id_verification_required', 403);
  return { wallet: row.wallet, humanVerified: scopeMatches, expiresAt: row.expires_at };
}
export function removeSession(token: string | undefined) {
  if (token) database().prepare('DELETE FROM wallet_sessions WHERE token_hash = ?').run(digest(token));
}
export async function completeWalletAuth(cookie: string | undefined, input: unknown) {
  if (!cookie || !/^[a-f0-9]{48}$/.test(cookie)) throw new WorldIdError('nonce_cookie_required', 401);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorldIdError('invalid_wallet_payload', 400);
  const payload = input as Record<string, unknown>;
  if (typeof payload.address !== 'string' || !isAddress(payload.address, { strict: false }) || typeof payload.message !== 'string' || payload.message.length > 12_000 || typeof payload.signature !== 'string' || !/^0x(?:[a-fA-F0-9]{2}){1,8192}$/.test(payload.signature)) throw new WorldIdError('invalid_wallet_payload', 400);
  const db = database();
  const row = db.prepare('SELECT nonce,origin,issued_at,expires_at,consumed_at FROM wallet_nonces WHERE id = ?').get(cookie) as
    { nonce: string; origin: string; issued_at: number; expires_at: number; consumed_at: number | null } | undefined;
  if (!row || row.consumed_at !== null || row.expires_at <= now()) throw new WorldIdError('nonce_expired_or_used', 409);
  let parsed;
  try { parsed = parseSiweMessage(payload.message); } catch { throw new WorldIdError('invalid_siwe_message', 400); }
  const wallet = getAddress(payload.address);
  let uriOrigin: string;
  try { uriOrigin = new URL(parsed.uri).origin; } catch { throw new WorldIdError('siwe_origin_mismatch', 400); }
  const issued = Date.parse(parsed.issued_at) / 1000; const expires = Date.parse(parsed.expiration_time ?? '') / 1000;
  if (row.origin !== appOrigin() || parsed.domain !== new URL(row.origin).host || uriOrigin !== row.origin || parsed.version !== '1' || parsed.chain_id !== 480 || parsed.nonce !== row.nonce || parsed.statement !== AUTH_STATEMENT || parsed.request_id !== cookie || parsed.address?.toLowerCase() !== wallet.toLowerCase()) throw new WorldIdError('siwe_scope_mismatch', 400);
  const notBefore = parsed.not_before ? Date.parse(parsed.not_before) / 1000 : undefined;
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued < row.issued_at - 60 || issued > now() + 30 || expires < issued || expires <= now() || expires > row.expires_at + 1 || (notBefore !== undefined && (!Number.isFinite(notBefore) || notBefore > now()))) throw new WorldIdError('siwe_time_rejected', 400);
  const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl(), { timeout: 10_000, retryCount: 0 }) });
  if (await client.getChainId() !== 480) throw new WorldIdError('wrong_wallet_verification_chain', 503);
  // viem verifies EOAs and ERC-1271/6492 smart-wallet signatures on World Chain.
  if (!await client.verifyMessage({ address: wallet, message: payload.message, signature: payload.signature as Hex })) throw new WorldIdError('wallet_signature_rejected', 401);
  db.exec('BEGIN IMMEDIATE');
  try {
    const changed = db.prepare('UPDATE wallet_nonces SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?').run(now(), cookie, now());
    if (changed.changes !== 1) throw new WorldIdError('nonce_expired_or_used', 409);
    const result = insertSession(wallet, null);
    db.exec('COMMIT'); return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function rememberPing(token: string, note: Hex, wallet: Address, target: Address) {
  database().prepare('INSERT INTO ping_requests(note,session_hash,wallet,target,expires_at) VALUES(?,?,?,?,?)').run(note, digest(token), wallet, target, now() + 600);
}
export function findPing(token: string, note: string) {
  const row = database().prepare('SELECT wallet,target,expires_at FROM ping_requests WHERE note = ? AND session_hash = ?').get(note, digest(token)) as
    { wallet: Address; target: Address; expires_at: number } | undefined;
  if (!row || row.expires_at <= now()) throw new WorldIdError('ping_request_expired', 410);
  return row;
}
