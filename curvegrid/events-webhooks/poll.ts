// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { NotProvenError } from '../scripts/config';
import { COUNTER_EVENT, type MultiBaasAdapter } from '../multibaas-basics/client';
import { evmAddress, hash, hexBytes, quantity, record, safeInteger, type RpcLog } from '../multibaas-basics/validation';
import type { Address, Hex } from 'viem';

export interface ExpectedIndexedEvent {
  address: Address; label: string; hash: Hex; blockHash: Hex; blockNumber: bigint; caller: Address; value: bigint; log: RpcLog;
}
/** Decoded conveniences and the original raw log must both agree with the independent RPC receipt. */
export function validateIndexedCounterEvent(input: unknown, expected: ExpectedIndexedEvent) {
  const item = record(input, 'indexed event'); const event = record(item.event, 'indexed event data'); const transaction = record(item.transaction, 'indexed transaction');
  assert.equal(event.name, 'Incremented'); assert.equal(event.signature, COUNTER_EVENT, 'Indexed event signature mismatch');
  assert.equal(evmAddress(record(event.contract, 'event contract').address, 'event emitter'), evmAddress(expected.address, 'expected counter'), 'Indexed emitter mismatch');
  assert.equal(record(event.contract, 'event contract').label, expected.label, 'Indexed contract label mismatch');
  assert.equal(hash(transaction.txHash, 'indexed hash'), hash(expected.hash, 'expected hash'), 'Indexed transaction mismatch');
  assert.equal(hash(transaction.blockHash, 'indexed block hash'), hash(expected.blockHash, 'expected block hash'), 'Indexed block mismatch');
  assert.equal(BigInt(safeInteger(transaction.blockNumber, 'indexed block')), expected.blockNumber, 'Indexed block number mismatch');
  assert.equal(evmAddress(transaction.from, 'indexed sender'), evmAddress(expected.caller, 'expected sender'), 'Indexed sender mismatch');
  assert.equal(safeInteger(event.indexInLog, 'indexed log index'), expected.log.logIndex, 'Indexed log index mismatch');
  assert(typeof event.rawFields === 'string' && event.rawFields.length <= 100_000, 'Indexed event needs bounded rawFields');
  const raw = record(JSON.parse(event.rawFields), 'raw indexed log');
  assert.equal(raw.removed, false, 'Reorganized indexed log is not proof');
  assert.equal(evmAddress(raw.address, 'raw emitter'), evmAddress(expected.log.address, 'RPC emitter'), 'Raw emitter mismatch');
  assert.equal(hash(raw.transactionHash, 'raw transaction'), hash(expected.hash, 'expected transaction'));
  assert.equal(hash(raw.blockHash, 'raw block'), hash(expected.blockHash, 'expected block'));
  assert.equal(quantity(raw.blockNumber, 'raw block number'), expected.blockNumber);
  assert.equal(quantity(raw.logIndex, 'raw log index'), BigInt(expected.log.logIndex ?? -1));
  assert.equal(hexBytes(raw.data, 'raw log data'), hexBytes(expected.log.data, 'RPC log data'), 'Indexed data mismatch');
  assert(Array.isArray(raw.topics), 'Invalid indexed topics');
  assert.deepEqual(raw.topics.map(topic => hash(topic, 'indexed topic')), expected.log.topics.map(topic => hash(topic, 'RPC topic')), 'Indexed topics mismatch');
  assert(Array.isArray(event.inputs) && event.inputs.length === 2, 'Unexpected counter event inputs');
  const caller = record(event.inputs[0], 'caller input'); const value = record(event.inputs[1], 'value input');
  assert.equal(caller.name, 'caller'); assert.equal(caller.type, 'address'); assert.equal(caller.hashed, false);
  assert.equal(evmAddress(caller.value, 'decoded caller'), evmAddress(expected.caller, 'expected caller'));
  assert.equal(value.name, 'value'); assert.equal(value.type, 'uint256'); assert.equal(value.hashed, false);
  const decodedValue = typeof value.value === 'number' ? BigInt(safeInteger(value.value, 'decoded value')) : quantity(value.value, 'decoded value');
  assert.equal(decodedValue, expected.value, 'Indexed decoded value mismatch');
  return { transactionHash: expected.hash, blockHash: expected.blockHash, blockNumber: expected.blockNumber.toString(),
    logIndex: expected.log.logIndex, address: expected.address, caller: expected.caller, value: expected.value.toString(), signature: COUNTER_EVENT };
}
export async function pollCounterEvent(
  mb: Pick<MultiBaasAdapter, 'indexingStatus' | 'listCounterEvents'>,
  expected: ExpectedIndexedEvent,
  options: { timeoutMs?: number; intervalMs?: number } = {},
) {
  const timeout = options.timeoutMs ?? 90_000; const interval = options.intervalMs ?? 2_000;
  assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 300_000, 'Invalid indexing timeout');
  assert(Number.isSafeInteger(interval) && interval > 0 && interval <= 10_000, 'Invalid polling interval');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = await mb.indexingStatus(expected.address, expected.label);
    assert(BigInt(status.startBlockNumber) <= expected.blockNumber, 'Indexer starts after the expected event');
    if (BigInt(status.latestBlockNumber) >= expected.blockNumber) {
      const found: unknown[] = [];
      for (let offset = 0; offset <= 1000; offset += 100) {
        const page = await mb.listCounterEvents(expected.address, expected.label, expected.hash, offset); found.push(...page);
        if (page.length < 100) break;
        assert(offset < 1000, 'Indexed event pagination exceeded the bound');
      }
      if (found.length) {
        assert.equal(found.length, 1, 'Expected exactly one indexed counter event');
        return { ...validateIndexedCounterEvent(found[0], expected), indexingStatus: status };
      }
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))));
  }
  throw new NotProvenError('MultiBaas did not index the independently confirmed counter event before the deadline');
}
