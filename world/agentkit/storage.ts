// SPDX-License-Identifier: MIT
import { Database } from 'bun:sqlite'
import type { AgentkitExtensionInfo } from '@worldcoin/agentkit'

type ChallengeRow = { nonce: string; endpoint: string; info_json: string; expires_ms: number; consumed: number }
export type IssuedChallenge = { endpoint: string; info: AgentkitExtensionInfo; expiresMs: number; consumed: boolean }
export type ConsumeResult = { ok: true; used: number; remaining: number } | { ok: false; reason: 'challenge' | 'quota' }

/** Durable, single-host SQLite storage. One transaction consumes the nonce and charges the human. */
export class SQLiteAgentKitStore {
  private readonly db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS agentkit_challenges (
        nonce TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        info_json TEXT NOT NULL,
        expires_ms INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS agentkit_usage (
        endpoint TEXT NOT NULL,
        human_id TEXT NOT NULL,
        used INTEGER NOT NULL CHECK (used >= 0),
        PRIMARY KEY (endpoint, human_id)
      );
    `)
  }

  issue(endpoint: string, info: AgentkitExtensionInfo): void {
    const expiresMs = Date.parse(info.expirationTime ?? '')
    if (!Number.isSafeInteger(expiresMs)) throw new Error('AgentKit challenge requires a finite expiration')
    this.db.transaction(() => {
      this.db.query('DELETE FROM agentkit_challenges WHERE expires_ms < ?').run(Date.now())
      this.db.query('INSERT INTO agentkit_challenges (nonce, endpoint, info_json, expires_ms) VALUES (?, ?, ?, ?)')
        .run(info.nonce, endpoint, JSON.stringify(info), expiresMs)
    }).immediate()
  }

  challenge(nonce: string): IssuedChallenge | undefined {
    const row = this.db.query<ChallengeRow, [string]>('SELECT * FROM agentkit_challenges WHERE nonce = ?').get(nonce)
    return row ? {
      endpoint: row.endpoint, info: JSON.parse(row.info_json) as AgentkitExtensionInfo,
      expiresMs: row.expires_ms, consumed: row.consumed === 1,
    } : undefined
  }

  consume(nonce: string, endpoint: string, humanId: string, limit: number): ConsumeResult {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('AgentKit quota must be a positive integer')
    return this.db.transaction((): ConsumeResult => {
      // BEGIN IMMEDIATE serializes this operation across independent connections/processes.
      const challenge = this.db.query<{ nonce: string }, [string, string, number]>(`
        UPDATE agentkit_challenges SET consumed = 1
        WHERE nonce = ? AND endpoint = ? AND consumed = 0 AND expires_ms >= ? RETURNING nonce
      `).get(nonce, endpoint, Date.now())
      if (!challenge) return { ok: false, reason: 'challenge' }

      const usage = this.db.query<{ used: number }, [string, string, number]>(`
        INSERT INTO agentkit_usage (endpoint, human_id, used) VALUES (?, ?, 1)
        ON CONFLICT (endpoint, human_id) DO UPDATE SET used = used + 1 WHERE used < ?
        RETURNING used
      `).get(endpoint, humanId, limit)
      // A valid signed request burns its nonce even when its human has exhausted the quota.
      return usage ? { ok: true, used: usage.used, remaining: limit - usage.used } : { ok: false, reason: 'quota' }
    }).immediate()
  }

  usage(endpoint: string, humanId: string): number {
    return this.db.query<{ used: number }, [string, string]>(
      'SELECT used FROM agentkit_usage WHERE endpoint = ? AND human_id = ?',
    ).get(endpoint, humanId)?.used ?? 0
  }

  close(): void { this.db.close() }
}
