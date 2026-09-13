// SPDX-License-Identifier: MIT
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Challenge } from './challenge';

export class WorldIdError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = 'WorldIdError'; }
}

interface ChallengeRow { payload: string; consumed_at: number | null; expires_at: number }

/** Synchronous SQLite transactions keep one-time consumption atomic across server workers. */
export class WorldIdStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY, wallet TEXT NOT NULL, expires_at INTEGER NOT NULL,
        consumed_at INTEGER, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS challenges_wallet_expiry ON challenges(wallet, expires_at);
      CREATE TABLE IF NOT EXISTS world_id_nullifiers (
        scope TEXT NOT NULL, nullifier_decimal TEXT NOT NULL, wallet TEXT NOT NULL,
        challenge_id TEXT NOT NULL UNIQUE, verified_at INTEGER NOT NULL,
        PRIMARY KEY(scope, nullifier_decimal)
      );
    `);
  }

  add(challenge: Challenge): void {
    const now = challenge.rp_context.created_at;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM challenges WHERE expires_at < ? AND consumed_at IS NULL').run(now - 3600);
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM challenges WHERE wallet = ? AND expires_at > ? AND consumed_at IS NULL')
        .get(challenge.wallet.toLowerCase(), now) as { count: number };
      if (row.count >= 5) throw new WorldIdError('too_many_active_challenges', 429);
      this.db.prepare('INSERT INTO challenges(id, wallet, expires_at, payload) VALUES (?, ?, ?, ?)')
        .run(challenge.challengeId, challenge.wallet.toLowerCase(), challenge.rp_context.expires_at, JSON.stringify(challenge));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  get(id: string, now: number): Challenge {
    const row = this.db.prepare('SELECT payload, consumed_at, expires_at FROM challenges WHERE id = ?').get(id) as ChallengeRow | undefined;
    if (!row) throw new WorldIdError('unknown_challenge', 404);
    if (row.consumed_at !== null) throw new WorldIdError('challenge_already_used', 409);
    if (row.expires_at <= now) throw new WorldIdError('challenge_expired', 410);
    return JSON.parse(row.payload) as Challenge;
  }

  /** Call only after cryptographic verification. No transaction is held during network I/O. */
  consume(challenge: Challenge, nullifierDecimal: string, now: number): void {
    if (!/^(0|[1-9][0-9]*)$/.test(nullifierDecimal) || BigInt(nullifierDecimal) >= 1n << 256n) throw new Error('Noncanonical uint256 nullifier');
    // V4 circuit uniqueness is RP/action scoped. Changing an app ID must not reset it.
    const scope = JSON.stringify([challenge.environment, challenge.rp_context.rp_id, challenge.action]);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = this.get(challenge.challengeId, now);
      if (JSON.stringify(fresh) !== JSON.stringify(challenge)) throw new WorldIdError('challenge_changed', 409);
      const prior = this.db.prepare('SELECT 1 FROM world_id_nullifiers WHERE scope = ? AND nullifier_decimal = ?').get(scope, nullifierDecimal);
      if (prior) throw new WorldIdError('nullifier_already_used', 409);
      this.db.prepare('INSERT INTO world_id_nullifiers(scope, nullifier_decimal, wallet, challenge_id, verified_at) VALUES (?, ?, ?, ?, ?)')
        .run(scope, nullifierDecimal, challenge.wallet.toLowerCase(), challenge.challengeId, now);
      this.db.prepare('UPDATE challenges SET consumed_at = ? WHERE id = ?').run(now, challenge.challengeId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  close(): void { this.db.close(); }
}
