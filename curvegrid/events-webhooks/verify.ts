// SPDX-License-Identifier: MIT
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { decodeEventLog, getAddress, isAddress, parseAbi, type Address, type Hex } from 'viem';
import type { Event as MultiBaasEvent, ContractInformation, MethodArg } from '@curvegrid/multibaas-sdk';

export const EVENT_SIGNATURE = 'Incremented(address,uint256)';
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_EVENTS = 50;
export const FRESHNESS_SECONDS = 300;
const eventAbi = parseAbi(['event Incremented(address indexed caller, uint256 value)']);
const verified = new WeakSet<object>();

export interface WebhookScope {
  chainId: number;
  contractAddress: Address;
  eventSignature: string;
  deploymentId: string;
  webhookId: number;
}
export interface WebhookConfig extends WebhookScope { secret: string }
export interface VerifiedEvent {
  envelopeId: string;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: number;
  blockHash: Hex;
  caller: Address;
  value: string;
  fingerprint: string;
  data: MultiBaasEvent;
}
export interface VerifiedDelivery {
  scope: WebhookScope;
  timestamp: number;
  receivedAt: string;
  rawBodySha256: string;
  ignored: number;
  events: readonly VerifiedEvent[];
}
export class WebhookError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'WebhookError'; }
}
const reject = (code = 'invalid_payload', status = 400): never => { throw new WebhookError(code, status); };
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || Buffer.byteLength(value) > max || /[\x00-\x1f\x7f]/.test(value)) return reject();
  return value;
}
function evmAddress(value: unknown): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || BigInt(value) === 0n) return reject();
  return getAddress(value);
}
function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return reject();
  return value.toLowerCase() as Hex;
}
function hex(value: unknown, maxBytes: number): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) || value.length > 2 + maxBytes * 2) return reject();
  return value.toLowerCase() as Hex;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return reject();
  return value;
}
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value) || value.length > 66) return reject();
  return BigInt(value);
}
function uint256(value: unknown): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  if (typeof result !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(result) || BigInt(result) >= 1n << 256n) return reject();
  return result;
}
function date(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) return reject();
  return result;
}
function boundedValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return reject();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 4096, true);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 64) return value.map(item => boundedValue(item, depth + 1));
  if (value && typeof value === 'object' && Object.keys(value).length <= 32) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key, 128), boundedValue(item, depth + 1)]));
  }
  return reject();
}
function contract(value: unknown): ContractInformation {
  const item = record(value); const address = evmAddress(item.address);
  return { address, addressAlias: text(item.addressAlias, 256, true), name: text(item.name, 256), label: text(item.label, 256) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function normalizeWebhookScope(input: WebhookScope): WebhookScope {
  if (input.chainId !== 11155111 || input.eventSignature !== EVENT_SIGNATURE || !Number.isSafeInteger(input.webhookId) || input.webhookId <= 0 ||
    typeof input.deploymentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(input.deploymentId)) return reject('invalid_configuration', 500);
  return { chainId: 11155111, contractAddress: evmAddress(input.contractAddress), eventSignature: EVENT_SIGNATURE,
    deploymentId: input.deploymentId, webhookId: input.webhookId };
}
export function validateWebhookConfig(input: WebhookConfig): WebhookConfig {
  const scope = normalizeWebhookScope(input);
  if (typeof input.secret !== 'string' || Buffer.byteLength(input.secret) < 16 || Buffer.byteLength(input.secret) > 1024) return reject('invalid_configuration', 500);
  return freeze({ ...scope, secret: input.secret });
}
export function scopeKey(input: WebhookScope): string { return sha256(JSON.stringify(normalizeWebhookScope(input))); }
export function assertVerifiedDelivery(input: VerifiedDelivery): void {
  if (!verified.has(input)) return reject('unverified_delivery', 400);
}

function parseEvent(value: unknown, scope: WebhookScope): VerifiedEvent | null {
  const envelope = record(value);
  if (typeof envelope.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.id) || envelope.event !== 'event.emitted') return reject();
  const data = record(envelope.data); const event = record(data.event); const transaction = record(data.transaction);
  const eventName = text(event.name, 128); const signature = text(event.signature, 512);
  const eventContract = contract(event.contract); const transactionContract = contract(transaction.contract);
  const transactionHash = hash(transaction.txHash); const blockHash = hash(transaction.blockHash);
  const blockNumber = integer(transaction.blockNumber); const logIndex = integer(event.indexInLog);
  const txIndexInBlock = integer(transaction.txIndexInBlock); const from = evmAddress(transaction.from);
  const txData = hex(transaction.txData, 65536);
  const triggeredAt = date(data.triggeredAt);
  if (!Array.isArray(event.inputs) || event.inputs.length > 64) return reject();
  for (const input of event.inputs) {
    const field = record(input);
    text(field.name, 128, true); text(field.type, 256); boundedValue(field.value);
    if (typeof field.hashed !== 'boolean') return reject();
  }
  if (event.rawFields !== undefined) text(event.rawFields, 32768);
  const method = record(transaction.method);
  const methodName = text(method.name, 128); const methodSignature = text(method.signature, 512);
  if (!Array.isArray(method.inputs) || method.inputs.length > 32) return reject();
  const methodInputs: MethodArg[] = method.inputs.map(value => { const item = record(value); return {
    name: text(item.name, 128, true), type: text(item.type, 256), value: boundedValue(item.value),
  }; });
  // A provider subscription spans every indexed contract. Valid unrelated events are ACKed,
  // but cannot enter the scoped store or authorize the root demo's receipt assertion.
  if (eventContract.address !== scope.contractAddress || transactionContract.address !== scope.contractAddress || signature !== scope.eventSignature) return null;
  if (eventName !== 'Incremented') return reject('inconsistent_event', 422);
  if (!Array.isArray(event.inputs) || event.inputs.length !== 2) return reject();
  const first = record(event.inputs[0]); const second = record(event.inputs[1]);
  if (first.name !== 'caller' || first.type !== 'address' || first.hashed !== false || second.name !== 'value' || second.type !== 'uint256' || second.hashed !== false) return reject();
  const caller = evmAddress(first.value); const amount = uint256(second.value);
  const rawFields = text(event.rawFields, 32768); let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(rawFields)); } catch { return reject(); }
  if (evmAddress(raw.address) !== scope.contractAddress || hash(raw.transactionHash) !== transactionHash || hash(raw.blockHash) !== blockHash ||
    quantity(raw.blockNumber) !== BigInt(blockNumber) || quantity(raw.transactionIndex) !== BigInt(txIndexInBlock) || quantity(raw.logIndex) !== BigInt(logIndex) || raw.removed !== false) return reject('inconsistent_event', 422);
  if (!Array.isArray(raw.topics) || raw.topics.length !== 2) return reject();
  const topics = raw.topics.map(hash) as [Hex, Hex]; const rawData = hex(raw.data, 32);
  let decoded;
  try { decoded = decodeEventLog({ abi: eventAbi, data: rawData, topics, strict: true }); } catch { return reject('inconsistent_event', 422); }
  if (getAddress(decoded.args.caller) !== caller || decoded.args.value.toString() !== amount) return reject('inconsistent_event', 422);
  const canonical: MultiBaasEvent = { triggeredAt, event: { name: 'Incremented', signature: EVENT_SIGNATURE,
    inputs: [{ name: 'caller', type: 'address', value: caller, hashed: false }, { name: 'value', type: 'uint256', value: amount, hashed: false }],
    rawFields, contract: eventContract, indexInLog: logIndex }, transaction: { from, txData, txHash: transactionHash,
    txIndexInBlock, blockHash, blockNumber, contract: transactionContract,
    method: { name: methodName, signature: methodSignature, inputs: methodInputs } } };
  const fingerprint = sha256(JSON.stringify({ transactionHash, logIndex, blockNumber, blockHash, from, txData, topics, rawData }));
  return { envelopeId: envelope.id.toLowerCase(), transactionHash, logIndex, blockNumber, blockHash, caller, value: amount, fingerprint, data: canonical };
}

/** Authenticity of the configured MultiBaas deployment; chain execution is checked separately by the demo. */
export function verifyDelivery(rawBody: Uint8Array, signature: string | null, timestamp: string | null, input: WebhookConfig, nowMs = Date.now()): VerifiedDelivery {
  const config = validateWebhookConfig(input);
  if (!rawBody.length || rawBody.length > MAX_BODY_BYTES) return reject('body_too_large', 413);
  if (!signature || !/^[0-9a-fA-F]{64}$/.test(signature) || !timestamp || !/^(?:0|[1-9][0-9]{0,12})$/.test(timestamp)) return reject('invalid_signature', 401);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return reject('invalid_clock', 500);
  const seconds = Number(timestamp);
  if (Math.abs(Math.floor(nowMs / 1000) - seconds) > FRESHNESS_SECONDS) return reject('stale_delivery', 401);
  const body = Buffer.from(rawBody);
  const expected = createHmac('sha256', Buffer.from(config.secret, 'utf8')).update(body).update(timestamp, 'ascii').digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return reject('invalid_signature', 401);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { return reject(); }
  if (!Array.isArray(payload) || payload.length < 1 || payload.length > MAX_EVENTS) return reject();
  const scope = normalizeWebhookScope(config);
  const parsed = payload.map(value => parseEvent(value, scope));
  const events = parsed.filter((event): event is VerifiedEvent => event !== null);
  const delivery = freeze({ scope, timestamp: seconds, receivedAt: new Date(nowMs).toISOString(), rawBodySha256: sha256(body), ignored: parsed.length - events.length, events });
  verified.add(delivery);
  return delivery;
}
