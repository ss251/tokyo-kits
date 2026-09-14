// SPDX-License-Identifier: MIT
// Protocol fixtures only. These tests are not a live MultiBaas webhook receipt.
import { describe, expect, test } from 'bun:test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeAbiParameters, getAddress, keccak256, padHex, stringToHex, toFunctionSelector, type Hex } from 'viem';
import { EVENT_SIGNATURE, MAX_BODY_BYTES, MAX_EVENTS, verifyDelivery, type WebhookConfig, type VerifiedDelivery } from '../events-webhooks/verify';
import { WebhookStore } from '../events-webhooks/store';
import { startWebhookServer } from '../events-webhooks/server';

const NOW = Date.UTC(2026, 8, 14, 0, 0, 0);
const CONTRACT = getAddress('0x1234567890123456789012345678901234567890');
const CALLER = getAddress('0x2234567890123456789012345678901234567890');
const OTHER = getAddress('0x3234567890123456789012345678901234567890');
const TX = `0x${'ab'.repeat(32)}` as Hex;
const BLOCK = `0x${'bc'.repeat(32)}` as Hex;
const CONFIG: WebhookConfig = { chainId: 11155111, contractAddress: CONTRACT, eventSignature: EVENT_SIGNATURE,
  deploymentId: 'fixture.multibaas.com', webhookId: 17, secret: randomBytes(32).toString('hex') };
function fixture(options: { id?: string; tx?: Hex; block?: Hex; value?: bigint; logIndex?: number } = {}) {
  const value = options.value ?? 1n; const tx = options.tx ?? TX; const block = options.block ?? BLOCK; const logIndex = options.logIndex ?? 0;
  const contract = { address: CONTRACT, addressAlias: 'counter', name: 'Counter', label: 'counter' };
  return { id: options.id ?? randomUUID(), event: 'event.emitted', data: { triggeredAt: new Date(NOW).toISOString(),
    event: { name: 'Incremented', signature: EVENT_SIGNATURE, inputs: [
      { name: 'caller', value: CALLER, type: 'address', hashed: false },
      { name: 'value', value: value.toString(), type: 'uint256', hashed: false },
    ], rawFields: JSON.stringify({ address: CONTRACT, topics: [keccak256(stringToHex(EVENT_SIGNATURE)), padHex(CALLER, { size: 32 })],
      data: encodeAbiParameters([{ type: 'uint256' }], [value]), blockNumber: '0x64', transactionHash: tx,
      transactionIndex: '0x0', blockHash: block, logIndex: `0x${logIndex.toString(16)}`, removed: false }), contract, indexInLog: logIndex },
    transaction: { from: CALLER, txData: toFunctionSelector('increment()'), txHash: tx, txIndexInBlock: 0, blockHash: block,
      blockNumber: 100, contract, method: { name: 'increment', signature: 'increment()', inputs: [] } } } };
}
function signing(body: Uint8Array, timestamp = String(NOW / 1000), config = CONFIG) {
  return createHmac('sha256', Buffer.from(config.secret, 'utf8')).update(Buffer.concat([body, Buffer.from(timestamp, 'ascii')])).digest('hex');
}
function checked(payload: unknown, config = CONFIG, timestamp = String(NOW / 1000), nowMs = NOW) {
  const body = Buffer.from(JSON.stringify(payload));
  return verifyDelivery(body, signing(body, timestamp, config), timestamp, config, nowMs);
}
function query(overrides: Partial<Parameters<WebhookStore['findEvent']>[0]> = {}) {
  return { chainId: CONFIG.chainId, contractAddress: CONTRACT, eventSignature: EVENT_SIGNATURE, deploymentId: CONFIG.deploymentId,
    webhookId: CONFIG.webhookId, transactionHash: TX, logIndex: 0, ...overrides };
}
function withStore(run: (store: WebhookStore, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tokyo-webhooks-')); const path = join(dir, 'events.sqlite'); const store = new WebhookStore(path);
  try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

describe('official webhook wire authentication and log consistency', () => {
  test('accepts the signed wire array and cross-checks the decoded Ethereum log', () => {
    const envelope = fixture(); const delivery = checked([envelope]);
    expect(delivery.scope.chainId).toBe(11155111);
    expect(delivery.events[0]?.envelopeId).toBe(envelope.id);
    expect(delivery.events[0]?.caller).toBe(CALLER);
    expect(delivery.events[0]?.value).toBe('1');
    expect(delivery.rawBodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(delivery.events[0]?.data)).toBe(true);
    expect(JSON.stringify(delivery)).not.toContain(CONFIG.secret);
  });
  test('authenticates original bytes, including whitespace, and rejects body or key substitution', () => {
    const body = Buffer.from(JSON.stringify([fixture()], null, 2)); const stamp = String(NOW / 1000); const signature = signing(body);
    expect(verifyDelivery(body, signature, stamp, CONFIG, NOW).events.length).toBe(1);
    expect(() => verifyDelivery(Buffer.from(JSON.stringify(JSON.parse(body.toString()))), signature, stamp, CONFIG, NOW)).toThrow('invalid_signature');
    expect(() => verifyDelivery(body, signature, stamp, { ...CONFIG, secret: randomBytes(32).toString('hex') }, NOW)).toThrow('invalid_signature');
    const prefixed = createHmac('sha256', CONFIG.secret).update(`${stamp}.`).update(body).digest('hex');
    expect(() => verifyDelivery(body, prefixed, stamp, CONFIG, NOW)).toThrow('invalid_signature');
  });
  test('enforces both freshness boundaries and canonical timestamp/signature headers', () => {
    const body = Buffer.from(JSON.stringify([fixture()]));
    for (const delta of [-300, 300]) {
      const stamp = String(NOW / 1000 + delta);
      expect(verifyDelivery(body, signing(body, stamp), stamp, CONFIG, NOW).events.length).toBe(1);
    }
    for (const delta of [-301, 301]) expect(() => checked([fixture()], CONFIG, String(NOW / 1000 + delta))).toThrow('stale_delivery');
    for (const stamp of [null, '', `0${NOW / 1000}`, `${NOW / 1000}.0`, `${NOW / 1000},${NOW / 1000}`]) {
      expect(() => verifyDelivery(body, signing(body), stamp, CONFIG, NOW)).toThrow('invalid_signature');
    }
    for (const signature of [null, '', 'a'.repeat(63), 'g'.repeat(64), `sha256=${signing(body)}`]) {
      expect(() => verifyDelivery(body, signature, String(NOW / 1000), CONFIG, NOW)).toThrow('invalid_signature');
    }
  });
  test('rejects oversized, malformed and management-model payloads', () => {
    expect(() => verifyDelivery(new Uint8Array(MAX_BODY_BYTES + 1), null, null, CONFIG, NOW)).toThrow('body_too_large');
    for (const payload of [null, {}, [], Array.from({ length: MAX_EVENTS + 1 }, () => fixture()), [{ ...fixture(), id: 7, eventType: 'event.emitted' }]]) {
      expect(() => checked(payload)).toThrow();
    }
    const body = Buffer.from('[invalid]');
    expect(() => verifyDelivery(body, signing(body), String(NOW / 1000), CONFIG, NOW)).toThrow('invalid_payload');
  });
  test('rejects unsupported configuration and excludes valid unrelated events', () => {
    expect(() => checked([fixture()], { ...CONFIG, chainId: 1 })).toThrow('invalid_configuration');
    expect(checked([fixture()], { ...CONFIG, contractAddress: OTHER }).ignored).toBe(1);
    expect(() => checked([fixture()], { ...CONFIG, eventSignature: 'Other(uint256)' })).toThrow('invalid_configuration');
    const envelope = fixture(); envelope.data.event.signature = 'Other(uint256)';
    expect(checked([envelope]).events).toEqual([]);
    expect(checked([envelope]).ignored).toBe(1);
  });
  test('rejects altered decoded values, removed logs and inconsistent transaction/block identities', () => {
    const changed = fixture(); changed.data.event.inputs[1]!.value = '2';
    expect(() => checked([changed])).toThrow('inconsistent_event');
    for (const patch of [{ removed: true }, { blockHash: `0x${'dd'.repeat(32)}` }, { transactionHash: `0x${'cc'.repeat(32)}` }, { logIndex: '0x1' }]) {
      const envelope = fixture(); envelope.data.event.rawFields = JSON.stringify({ ...JSON.parse(envelope.data.event.rawFields), ...patch });
      expect(() => checked([envelope])).toThrow('inconsistent_event');
    }
  });
});

describe('persistent and atomic authenticated delivery storage', () => {
  test('retains authentic evidence across real SQLite connections without credentials', () => withStore((store, path) => {
    const delivery = checked([fixture()]); expect(store.ingest(delivery)).toEqual({ accepted: 1, duplicates: 0, ignored: 0 });
    const second = new WebhookStore(path);
    try {
      const found = second.findEvent(query());
      expect(found?.authenticated).toBe(true); expect(found?.rawBodySha256).toBe(delivery.rawBodySha256);
      expect(found?.event.transactionHash).toBe(TX); expect(JSON.stringify(found)).not.toContain(CONFIG.secret);
    } finally { second.close(); }
  }));
  test('acknowledges duplicate envelope and duplicate log with a fresh envelope ID', () => withStore(store => {
    const first = fixture(); expect(store.ingest(checked([first]))).toEqual({ accepted: 1, duplicates: 0, ignored: 0 });
    expect(store.ingest(checked([first]))).toEqual({ accepted: 0, duplicates: 1, ignored: 0 });
    expect(store.ingest(checked([{ ...first, id: randomUUID() }]))).toEqual({ accepted: 0, duplicates: 1, ignored: 0 });
    expect(store.findEvent(query())?.event.envelopeId).toBe(first.id);
  }));
  test('does not authorize a matching log from a different deployment, webhook or contract scope', () => withStore(store => {
    store.ingest(checked([fixture()]));
    expect(store.findEvent(query({ deploymentId: 'other.multibaas.com' }))).toBeNull();
    expect(store.findEvent(query({ webhookId: 18 }))).toBeNull();
    expect(store.findEvent(query({ contractAddress: OTHER }))).toBeNull();
  }));
  test('accepts the matching event in a mixed provider batch and never stores unrelated logs', () => withStore(store => {
    const unrelatedTx = `0x${'da'.repeat(32)}` as Hex; const unrelated = fixture({ tx: unrelatedTx });
    unrelated.data.event.contract = { ...unrelated.data.event.contract, address: OTHER };
    unrelated.data.transaction.contract = { ...unrelated.data.transaction.contract, address: OTHER };
    unrelated.data.event.rawFields = JSON.stringify({ ...JSON.parse(unrelated.data.event.rawFields), address: OTHER });
    const malformed = structuredClone(unrelated); malformed.data.event.inputs[0]!.hashed = undefined as unknown as boolean;
    expect(() => checked([fixture(), malformed])).toThrow('invalid_payload');
    const result = store.ingest(checked([unrelated, fixture()]));
    expect(result).toEqual({ accepted: 1, duplicates: 0, ignored: 1 });
    expect(store.findEvent(query())).not.toBeNull();
    expect(store.findEvent(query({ transactionHash: unrelatedTx }))).toBeNull();
    expect(store.ingest(checked([unrelated]))).toEqual({ accepted: 0, duplicates: 0, ignored: 1 });
  }));
  test('rejects serialized or hand-authored objects as unverified deliveries', () => withStore(store => {
    const copied = JSON.parse(JSON.stringify(checked([fixture()]))) as VerifiedDelivery;
    expect(() => store.ingest(copied)).toThrow('unverified_delivery');
    expect(store.findEvent(query())).toBeNull();
  }));
  test('rolls back the entire batch when an envelope ID is reused for another log', () => withStore(store => {
    const original = fixture(); store.ingest(checked([original]));
    const newTx = `0x${'cd'.repeat(32)}` as Hex; const fresh = fixture({ tx: newTx });
    const conflict = fixture({ id: original.id, tx: `0x${'de'.repeat(32)}` });
    expect(() => store.ingest(checked([fresh, conflict]))).toThrow('conflicting_replay');
    expect(store.findEvent(query({ transactionHash: newTx }))).toBeNull();
    expect(store.findEvent(query())?.event.envelopeId).toBe(original.id);
  }));
  test('rejects conflicting chain-log content even with a new envelope ID', () => withStore(store => {
    store.ingest(checked([fixture()]));
    expect(() => store.ingest(checked([fixture({ block: `0x${'ee'.repeat(32)}` })]))).toThrow('conflicting_replay');
    expect(store.findEvent(query())?.event.blockHash).toBe(BLOCK);
  }));
});

test('HTTP receiver accepts only signed JSON and acknowledges authenticated retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokyo-webhook-http-')); const store = new WebhookStore(join(dir, 'events.sqlite'));
  const server = startWebhookServer({ config: CONFIG, store, hostname: '127.0.0.1', port: 0 });
  try {
    const url = `http://127.0.0.1:${server.port}`; const body = Buffer.from(JSON.stringify([fixture()]));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { 'Content-Type': 'application/json', 'X-MultiBaas-Timestamp': timestamp, 'X-MultiBaas-Signature': signing(body, timestamp) };
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const missing = await fetch(`${url}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(missing.status).toBe(401); expect(store.findEvent(query())).toBeNull();
    const first = await fetch(`${url}/webhook`, { method: 'POST', headers, body });
    expect(first.status).toBe(200); expect(await first.json()).toEqual({ ok: true, accepted: 1, duplicates: 0, ignored: 0 });
    const duplicate = await fetch(`${url}/webhook`, { method: 'POST', headers, body });
    expect(duplicate.status).toBe(200); expect(await duplicate.json()).toEqual({ ok: true, accepted: 0, duplicates: 1, ignored: 0 });
    const unrelated = fixture({ tx: `0x${'ca'.repeat(32)}` });
    unrelated.data.event.contract = { ...unrelated.data.event.contract, address: OTHER };
    unrelated.data.transaction.contract = { ...unrelated.data.transaction.contract, address: OTHER };
    unrelated.data.event.rawFields = JSON.stringify({ ...JSON.parse(unrelated.data.event.rawFields), address: OTHER });
    const unrelatedBody = Buffer.from(JSON.stringify([unrelated]));
    const ignored = await fetch(`${url}/webhook`, { method: 'POST', headers: { ...headers,
      'X-MultiBaas-Signature': signing(unrelatedBody, timestamp) }, body: unrelatedBody });
    expect(ignored.status).toBe(200); expect(await ignored.json()).toEqual({ ok: true, accepted: 0, duplicates: 0, ignored: 1 });
    expect(store.findEvent(query({ transactionHash: unrelated.data.transaction.txHash }))).toBeNull();
    const wrongType = await fetch(`${url}/webhook`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body });
    expect(wrongType.status).toBe(415);
  } finally { server.stop(true); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
