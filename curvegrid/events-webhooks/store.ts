// SPDX-License-Identifier: MIT
import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isHex, type Hex } from 'viem';
import { assertVerifiedDelivery, normalizeWebhookScope, scopeKey, WebhookError, type VerifiedDelivery, type VerifiedEvent, type WebhookScope } from './verify';

export interface StoredWebhookEvent {
  authenticated: true;
  scope: WebhookScope;
  rawBodySha256: string;
  timestamp: number;
  receivedAt: string;
  event: VerifiedEvent;
}
export interface EventQuery extends WebhookScope { transactionHash: Hex; logIndex: number }
type Row = { fingerprint: string; payload_json: string; transaction_hash: string; log_index: number };

/** Private local event storage. It holds no webhook signing secret or API credentials. */
export class WebhookStore {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run(`CREATE TABLE IF NOT EXISTS webhook_events (
      scope_key TEXT NOT NULL,
      transaction_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (scope_key, transaction_hash, log_index)
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS webhook_envelopes (
      scope_key TEXT NOT NULL,
      envelope_id TEXT NOT NULL,
      transaction_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (scope_key, envelope_id),
      FOREIGN KEY (scope_key, transaction_hash, log_index)
        REFERENCES webhook_events(scope_key, transaction_hash, log_index)
    )`);
  }
  ingest(delivery: VerifiedDelivery): { accepted: number; duplicates: number; ignored: number } {
    assertVerifiedDelivery(delivery);
    const scope = normalizeWebhookScope(delivery.scope); const key = scopeKey(scope);
    return this.db.transaction(() => {
      let accepted = 0; let duplicates = 0;
      for (const event of delivery.events) {
        const envelope = this.db.query<Row, [string, string]>(
          'SELECT fingerprint, transaction_hash, log_index FROM webhook_envelopes WHERE scope_key = ? AND envelope_id = ?',
        ).get(key, event.envelopeId);
        if (envelope) {
          if (envelope.fingerprint !== event.fingerprint || envelope.transaction_hash !== event.transactionHash || envelope.log_index !== event.logIndex) {
            throw new WebhookError('conflicting_replay', 409);
          }
          duplicates++; continue;
        }
        const existing = this.db.query<Row, [string, string, number]>(
          'SELECT fingerprint, payload_json FROM webhook_events WHERE scope_key = ? AND transaction_hash = ? AND log_index = ?',
        ).get(key, event.transactionHash, event.logIndex);
        if (existing && existing.fingerprint !== event.fingerprint) throw new WebhookError('conflicting_replay', 409);
        if (existing) duplicates++;
        else {
          const stored: StoredWebhookEvent = { authenticated: true, scope, rawBodySha256: delivery.rawBodySha256,
            timestamp: delivery.timestamp, receivedAt: delivery.receivedAt, event };
          this.db.query('INSERT INTO webhook_events (scope_key, transaction_hash, log_index, fingerprint, payload_json) VALUES (?, ?, ?, ?, ?)')
            .run(key, event.transactionHash, event.logIndex, event.fingerprint, JSON.stringify(stored));
          accepted++;
        }
        this.db.query('INSERT INTO webhook_envelopes (scope_key, envelope_id, transaction_hash, log_index, fingerprint) VALUES (?, ?, ?, ?, ?)')
          .run(key, event.envelopeId, event.transactionHash, event.logIndex, event.fingerprint);
      }
      return { accepted, duplicates, ignored: delivery.ignored };
    }).immediate();
  }
  /** Call with the same verified deployment/webhook scope used by the receiver. */
  findEvent(query: EventQuery): StoredWebhookEvent | null {
    const key = scopeKey(query);
    if (!isHex(query.transactionHash, { strict: true }) || query.transactionHash.length !== 66 ||
      !Number.isSafeInteger(query.logIndex) || query.logIndex < 0) throw new WebhookError('invalid_query', 400);
    const row = this.db.query<{ payload_json: string }, [string, string, number]>(
      'SELECT payload_json FROM webhook_events WHERE scope_key = ? AND transaction_hash = ? AND log_index = ?',
    ).get(key, query.transactionHash.toLowerCase(), query.logIndex);
    return row ? JSON.parse(row.payload_json) as StoredWebhookEvent : null;
  }
  close(): void { this.db.close(); }
}
