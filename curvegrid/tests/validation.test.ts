// SPDX-License-Identifier: MIT
// Deliberately fabricated offline fixtures; no fixture is a service or chain receipt.
import { describe, expect, test } from 'bun:test';
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from 'viem';
import { COUNTER_ABI } from '../multibaas-basics/demo';
import { hash, SEPOLIA_CHAIN_ID, validateReadOwner, validateReadValue, validateSdkReceipt, validateUnsignedTransaction, type RpcLog, type UnsignedIntent } from '../multibaas-basics/validation';
import { pollCounterEvent, validateIndexedCounterEvent, type ExpectedIndexedEvent } from '../events-webhooks/poll';

const FROM = getAddress('0x1111111111111111111111111111111111111111');
const TO = getAddress('0x2222222222222222222222222222222222222222');
const OTHER = getAddress('0x3333333333333333333333333333333333333333');
const HASH = `0x${'ab'.repeat(32)}` as Hex; const BLOCK_HASH = `0x${'cd'.repeat(32)}` as Hex;
const INTENT: UnsignedIntent = { kind: 'call', chainId: SEPOLIA_CHAIN_ID, from: FROM, to: TO, data: '0xd09de08a', nonce: 7 };
function unsigned(overrides: Record<string, unknown> = {}) {
  return { kind: 'TransactionToSignResponse', submitted: false,
    tx: { from: FROM, to: TO, data: INTENT.data, nonce: 7, value: '0', gas: 100_000, type: 2,
      gasFeeCap: '20000000000', gasTipCap: '1000000000', ...overrides } };
}
function rpcLog(): RpcLog {
  return { address: TO, topics: encodeEventTopics({ abi: COUNTER_ABI, eventName: 'Incremented', args: { caller: FROM } }).map(topic => hash(topic, 'offline fixture topic')),
    data: encodeAbiParameters([{ type: 'uint256' }], [1n]), logIndex: 0, transactionHash: HASH, blockHash: BLOCK_HASH, blockNumber: 123n, removed: false };
}
function rawLog() {
  const log = rpcLog(); return { ...log, blockNumber: '0x7b', logIndex: '0x0', transactionIndex: '0x0' };
}
function sdkReceipt() { return { data: { status: '0x1', transactionHash: HASH, blockHash: BLOCK_HASH, blockNumber: '0x7b', contractAddress: null, logs: [rawLog()] } }; }
function indexed() {
  return { triggeredAt: '2026-09-14T00:00:00Z', event: { name: 'Incremented', signature: 'Incremented(address,uint256)', indexInLog: 0,
    contract: { address: TO, label: 'kit-counter' }, rawFields: JSON.stringify(rawLog()), inputs: [
      { name: 'caller', type: 'address', hashed: false, value: FROM }, { name: 'value', type: 'uint256', hashed: false, value: '1' },
    ] }, transaction: { from: FROM, txHash: HASH, blockHash: BLOCK_HASH, blockNumber: 123 } };
}
const EXPECTED: ExpectedIndexedEvent = { address: TO, label: 'kit-counter', hash: HASH, blockHash: BLOCK_HASH, blockNumber: 123n, caller: FROM, value: 1n, log: rpcLog() };

describe('unsigned transaction intent boundary', () => {
  test('reconstructs only approved signing fields with lossless fee arithmetic', () => {
    const tx = validateUnsignedTransaction(unsigned(), INTENT);
    expect(tx).toEqual({ type: 'eip1559', chainId: SEPOLIA_CHAIN_ID, nonce: 7, gas: 100_000n, value: 0n,
      to: TO, data: INTENT.data, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    expect('from' in tx).toBe(false); expect('submitted' in tx).toBe(false);
  });
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['sender', { from: OTHER }, 'Sender mismatch'], ['destination', { to: OTHER }, 'Destination mismatch'],
    ['calldata', { data: '0xdeadbeef' }, 'Calldata mismatch'], ['nonce', { nonce: 8 }, 'Nonce mismatch'],
    ['value', { value: '1' }, 'zero value'], ['unsafe nonce', { nonce: Number.MAX_SAFE_INTEGER + 1 }, 'Invalid nonce'],
    ['negative gas', { gas: -1 }, 'Invalid gas'], ['oversized gas', { gas: 2_000_001 }, 'Gas exceeds'],
    ['fractional fee', { gasFeeCap: '0.01' }, 'Invalid fee cap'], ['fee cap', { gasFeeCap: '50000000001' }, 'fee exceeds'],
    ['tip above fee', { gasTipCap: '20000000001' }, 'fee exceeds'], ['mixed fee modes', { gasPrice: '1' }, 'legacy gas price'],
    ['unsupported type', { type: 4 }, 'Only legacy and EIP-1559'], ['authorization list', { authorizationList: [] }, 'Unexpected unsigned'],
    ['remote chain override', { chainId: 1 }, 'Unexpected unsigned'],
  ];
  for (const [name, changes, message] of refusals) test(`refuses changed ${name}`, () => {
    expect(() => validateUnsignedTransaction(unsigned(changes), INTENT)).toThrow(message);
  });
  test('refuses an already-submitted response and unknown response kinds', () => {
    expect(() => validateUnsignedTransaction({ ...unsigned(), submitted: true }, INTENT)).toThrow('unsubmitted');
    expect(() => validateUnsignedTransaction({ ...unsigned(), kind: 'MethodCallResponse' }, INTENT)).toThrow('unsigned write');
    expect(() => validateUnsignedTransaction(unsigned(), { ...INTENT, chainId: 1 } as unknown as UnsignedIntent)).toThrow('Only Sepolia');
  });
  test('enforces the overall gas cost cap and cannot be configured above starter limits', () => {
    expect(() => validateUnsignedTransaction(unsigned({ gas: 2_000_000 }), INTENT)).toThrow('fee exceeds');
    expect(() => validateUnsignedTransaction(unsigned(), { ...INTENT, maxFeePerGas: 50_000_000_001n })).toThrow('Invalid fee limit');
  });
  test('legacy fees and contract creation use their distinct supported schemas', () => {
    const legacy = unsigned({ type: 0, gasPrice: '0x3b9aca00', gasFeeCap: undefined, gasTipCap: undefined });
    expect(validateUnsignedTransaction(legacy, INTENT).type).toBe('legacy');
    const deployment = { submitted: false, tx: { ...legacy.tx, to: null, data: '0x6000' } };
    const intent: UnsignedIntent = { ...INTENT, kind: 'deployment', to: null, data: '0x6000' };
    const tx = validateUnsignedTransaction(deployment, intent); expect(tx.to).toBeUndefined();
    expect(() => validateUnsignedTransaction({ ...deployment, tx: { ...deployment.tx, to: TO } }, intent)).toThrow('must not have a destination');
  });
});

describe('read and receipt validation', () => {
  test('read output must be the expected scalar type without Number rounding', () => {
    expect(validateReadValue({ kind: 'MethodCallResponse', output: '9007199254740993' })).toBe(9_007_199_254_740_993n);
    for (const output of [1, ['1'], { value: '1' }, '-1', '1.2', (1n << 256n).toString()]) {
      expect(() => validateReadValue({ kind: 'MethodCallResponse', output })).toThrow();
    }
    expect(validateReadOwner({ kind: 'MethodCallResponse', output: FROM })).toBe(FROM);
    expect(() => validateReadOwner({ kind: 'TransactionToSignResponse', output: FROM })).toThrow('read response');
  });
  test('receipt normalization preserves independent log identity', () => {
    const receipt = validateSdkReceipt(sdkReceipt(), HASH); expect(receipt.status).toBe('success');
    expect(receipt.blockNumber).toBe(123n); expect(receipt.logs).toEqual([rpcLog()]);
  });
  test('rejects failed receipts, different transactions and reorganized logs', () => {
    const failed = sdkReceipt(); failed.data.status = '0x0'; expect(() => validateSdkReceipt(failed, HASH)).toThrow('not successful');
    expect(() => validateSdkReceipt(sdkReceipt(), BLOCK_HASH)).toThrow('transaction mismatch');
    const removed = sdkReceipt(); removed.data.logs[0]!.removed = true; expect(() => validateSdkReceipt(removed, HASH)).toThrow('Removed event');
    const foreign = sdkReceipt(); foreign.data.logs[0]!.blockHash = HASH; expect(() => validateSdkReceipt(foreign, HASH)).toThrow('Log block mismatch');
  });
});

describe('indexed event reconciliation', () => {
  test('matches decoded fields and raw log against the independent RPC receipt', () => {
    expect(validateIndexedCounterEvent(indexed(), EXPECTED)).toMatchObject({ transactionHash: HASH, value: '1', logIndex: 0 });
  });
  test('rejects another emitter or transaction and altered raw topics/data', () => {
    const wrongEmitter = indexed(); wrongEmitter.event.contract.address = OTHER;
    expect(() => validateIndexedCounterEvent(wrongEmitter, EXPECTED)).toThrow('emitter mismatch');
    const wrongHash = indexed(); wrongHash.transaction.txHash = BLOCK_HASH;
    expect(() => validateIndexedCounterEvent(wrongHash, EXPECTED)).toThrow('transaction mismatch');
    const wrongData = indexed(); wrongData.event.rawFields = JSON.stringify({ ...rawLog(), data: '0x' });
    expect(() => validateIndexedCounterEvent(wrongData, EXPECTED)).toThrow('data mismatch');
    const wrongTopic = indexed(); wrongTopic.event.rawFields = JSON.stringify({ ...rawLog(), topics: [HASH] });
    expect(() => validateIndexedCounterEvent(wrongTopic, EXPECTED)).toThrow('topics mismatch');
  });
  test('never treats decoder conveniences as stronger evidence than the raw event', () => {
    const wrongValue = indexed(); wrongValue.event.inputs[1]!.value = '2';
    expect(() => validateIndexedCounterEvent(wrongValue, EXPECTED)).toThrow('value mismatch');
    const removed = indexed(); removed.event.rawFields = JSON.stringify({ ...rawLog(), removed: true });
    expect(() => validateIndexedCounterEvent(removed, EXPECTED)).toThrow('Reorganized');
  });
  test('polling distinguishes indexed evidence, duplicate results and timeout', async () => {
    const status = { latestBlockNumber: 123, latestBlockHash: BLOCK_HASH, startBlockNumber: 100, isProcessingPastLogs: false };
    const mb = { indexingStatus: async () => status, listCounterEvents: async () => [indexed()] };
    expect((await pollCounterEvent(mb, EXPECTED, { timeoutMs: 100, intervalMs: 1 })).transactionHash).toBe(HASH);
    await expect(pollCounterEvent({ ...mb, listCounterEvents: async () => [indexed(), indexed()] }, EXPECTED)).rejects.toThrow('exactly one');
    const other = indexed(); other.transaction.txHash = BLOCK_HASH;
    expect((await pollCounterEvent({ ...mb, listCounterEvents: async () => [other, indexed()] }, EXPECTED, { timeoutMs: 100, intervalMs: 1 })).transactionHash).toBe(HASH);
    await expect(pollCounterEvent({ ...mb, indexingStatus: async () => ({ ...status, latestBlockNumber: 100 }), listCounterEvents: async () => [indexed()] }, EXPECTED, { timeoutMs: 100, intervalMs: 1 })).resolves.toBeTruthy();
    await expect(pollCounterEvent({ ...mb, listCounterEvents: async () => [] }, EXPECTED, { timeoutMs: 5, intervalMs: 1 })).rejects.toThrow('NOT PROVEN');
    await expect(pollCounterEvent({ ...mb, indexingStatus: async () => ({ ...status, startBlockNumber: 124 }) }, EXPECTED)).rejects.toThrow('starts after');
  });
});
