// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

export const SEPOLIA_CHAIN_ID = 11_155_111;
export const MAX_GAS = 2_000_000n;
export const MAX_FEE_PER_GAS = 50_000_000_000n;
export const MAX_TRANSACTION_COST = 20_000_000_000_000_000n;
export interface UnsignedIntent {
  kind: 'deployment' | 'call'; chainId: typeof SEPOLIA_CHAIN_ID;
  from: Address; to: Address | null; data: Hex; nonce: number;
  maxGas?: bigint; maxFeePerGas?: bigint; maxCostWei?: bigint;
}
export type ValidatedUnsigned = {
  chainId: typeof SEPOLIA_CHAIN_ID; nonce: number; gas: bigint; value: 0n; data: Hex; to?: Address;
} & ({ type: 'legacy'; gasPrice: bigint } | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint });
export interface RpcLog {
  address: Address; topics: readonly Hex[]; data: Hex; logIndex: number | null;
  transactionHash: Hex | null; blockHash: Hex | null; blockNumber: bigint | null; removed?: boolean;
}
export interface SdkReceipt {
  transactionHash: Hex; blockHash: Hex; blockNumber: bigint; status: 'success';
  contractAddress: Address | null; logs: RpcLog[];
}
export function record(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
  return value as Record<string, unknown>;
}
export function evmAddress(value: unknown, label: string): Address {
  assert(typeof value === 'string' && isAddress(value, { strict: false }), `Invalid ${label}`);
  return getAddress(value);
}
export function hexBytes(value: unknown, label: string, maxBytes = 100_000): Hex {
  assert(typeof value === 'string' && isHex(value, { strict: true }) && /^0x(?:[0-9a-fA-F]{2})*$/.test(value), `Invalid ${label}`);
  assert((value.length - 2) / 2 <= maxBytes, `${label} is too large`); return value.toLowerCase() as Hex;
}
export function hash(value: unknown, label: string): Hex {
  const result = hexBytes(value, label, 32); assert.equal(result.length, 66, `Invalid ${label}`); return result;
}
export function safeInteger(value: unknown, label: string): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `Invalid ${label}`); return value;
}
export function quantity(value: unknown, label: string): bigint {
  assert(typeof value === 'string' && /^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(value), `Invalid ${label}`);
  const parsed = BigInt(value); assert(parsed < (1n << 256n), `${label} exceeds uint256`); return parsed;
}
/** Only scalar uint256 output is valid for KitCounter.value(), with formatInts:as_strings. */
export function validateReadValue(result: unknown): bigint {
  const value = record(result, 'read response'); assert.equal(value.kind, 'MethodCallResponse', 'Expected a read response');
  assert(typeof value.output === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value.output), 'Expected a decimal uint256 string');
  return quantity(value.output, 'counter value');
}
export function validateReadOwner(result: unknown): Address {
  const value = record(result, 'owner response'); assert.equal(value.kind, 'MethodCallResponse', 'Expected a read response');
  return evmAddress(value.output, 'counter owner');
}
function cap(value: bigint | undefined, maximum: bigint, label: string) {
  const result = value ?? maximum; assert(result > 0n && result <= maximum, `Invalid ${label} limit`); return result;
}
/** Allow only the locally encoded zero-value counter intent; never spread remote fields into a signature. */
export function validateUnsignedTransaction(result: unknown, intent: UnsignedIntent): ValidatedUnsigned {
  assert.equal(intent.chainId, SEPOLIA_CHAIN_ID, 'Only Sepolia is supported');
  const envelope = record(result, 'unsigned response');
  assert.equal(envelope.submitted, false, 'MultiBaas must return an unsubmitted transaction');
  if (intent.kind === 'call') assert.equal(envelope.kind, 'TransactionToSignResponse', 'Expected an unsigned write response');
  else assert(envelope.kind === undefined, 'Deployment response must use the SDK deployment schema');
  const tx = record(envelope.tx, 'unsigned transaction');
  const allowed = new Set(['nonce', 'gasPrice', 'gasFeeCap', 'gasTipCap', 'gas', 'from', 'to', 'value', 'data', 'hash', 'type']);
  assert(Object.keys(tx).every(key => allowed.has(key)), 'Unexpected unsigned transaction field');
  assert.equal(evmAddress(tx.from, 'transaction sender'), evmAddress(intent.from, 'expected sender'), 'Sender mismatch');
  assert.equal(safeInteger(tx.nonce, 'nonce'), safeInteger(intent.nonce, 'expected nonce'), 'Nonce mismatch');
  const gas = BigInt(safeInteger(tx.gas, 'gas')); assert(gas > 0n && gas <= cap(intent.maxGas, MAX_GAS, 'gas'), 'Gas exceeds limit');
  assert.equal(quantity(tx.value, 'transaction value'), 0n, 'Counter transactions must have zero value');
  const data = hexBytes(tx.data, 'transaction data'); assert.equal(data, hexBytes(intent.data, 'expected data'), 'Calldata mismatch');
  let to: Address | undefined;
  if (intent.kind === 'deployment') {
    assert.equal(intent.to, null, 'Deployment intent must create a contract');
    assert(tx.to === null || tx.to === undefined, 'Deployment must not have a destination');
  } else {
    assert(intent.to, 'Call intent needs a destination'); to = evmAddress(tx.to, 'transaction destination');
    assert.equal(to, evmAddress(intent.to, 'expected destination'), 'Destination mismatch');
  }
  const common = { chainId: SEPOLIA_CHAIN_ID as typeof SEPOLIA_CHAIN_ID, nonce: intent.nonce, gas, value: 0n as const, data, ...(to ? { to } : {}) };
  const feeLimit = cap(intent.maxFeePerGas, MAX_FEE_PER_GAS, 'fee');
  const costLimit = cap(intent.maxCostWei, MAX_TRANSACTION_COST, 'cost');
  if (tx.type === 0) {
    assert(tx.gasFeeCap == null && tx.gasTipCap == null, 'Legacy transaction has EIP-1559 fees');
    const gasPrice = quantity(tx.gasPrice, 'gas price'); assert(gasPrice > 0n && gasPrice <= feeLimit && gas * gasPrice <= costLimit, 'Transaction fee exceeds limit');
    return { ...common, type: 'legacy', gasPrice };
  }
  assert.equal(tx.type, 2, 'Only legacy and EIP-1559 transactions are supported');
  assert(tx.gasPrice == null, 'EIP-1559 transaction has a legacy gas price');
  const maxFeePerGas = quantity(tx.gasFeeCap, 'fee cap'); const maxPriorityFeePerGas = quantity(tx.gasTipCap, 'tip cap');
  assert(maxFeePerGas > 0n && maxPriorityFeePerGas <= maxFeePerGas && maxFeePerGas <= feeLimit && gas * maxFeePerGas <= costLimit, 'Transaction fee exceeds limit');
  return { ...common, type: 'eip1559', maxFeePerGas, maxPriorityFeePerGas };
}
export function validateSdkReceipt(input: unknown, expectedHash: Hex): SdkReceipt {
  const receipt = record(input, 'MultiBaas receipt'); const data = record(receipt.data, 'receipt data');
  assert.equal(quantity(data.status, 'receipt status'), 1n, 'MultiBaas receipt is not successful');
  const transactionHash = hash(data.transactionHash, 'receipt transaction hash'); assert.equal(transactionHash, hash(expectedHash, 'expected hash'), 'Receipt transaction mismatch');
  const blockHash = hash(data.blockHash, 'receipt block hash'); const blockNumber = quantity(data.blockNumber, 'receipt block number');
  let contractAddress: Address | null = null;
  if (data.contractAddress != null) {
    const parsed = evmAddress(data.contractAddress, 'created address'); if (BigInt(parsed) !== 0n) contractAddress = parsed;
  }
  assert(Array.isArray(data.logs) && data.logs.length <= 1000, 'Invalid receipt logs');
  const logs = data.logs.map((raw: unknown): RpcLog => {
    const log = record(raw, 'receipt log'); assert.equal(log.removed, false, 'Removed event cannot prove execution');
    const logHash = hash(log.transactionHash, 'log transaction hash'); assert.equal(logHash, transactionHash, 'Log transaction mismatch');
    const logBlockHash = hash(log.blockHash, 'log block hash'); assert.equal(logBlockHash, blockHash, 'Log block mismatch');
    const logBlockNumber = quantity(log.blockNumber, 'log block number'); assert.equal(logBlockNumber, blockNumber, 'Log block number mismatch');
    assert(Array.isArray(log.topics) && log.topics.length <= 4, 'Invalid log topics');
    const index = quantity(log.logIndex, 'log index'); assert(index <= BigInt(Number.MAX_SAFE_INTEGER), 'Unsafe log index');
    return { address: evmAddress(log.address, 'log emitter'), topics: log.topics.map(topic => hash(topic, 'event topic')),
      data: hexBytes(log.data, 'log data'), logIndex: Number(index), transactionHash, blockHash, blockNumber, removed: false };
  });
  return { transactionHash, blockHash, blockNumber, status: 'success', contractAddress, logs };
}
