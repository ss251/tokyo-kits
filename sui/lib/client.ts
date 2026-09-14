// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiClientTypes } from '@mysten/sui/client';
import { bcs } from '@mysten/sui/bcs';
import { isValidSuiAddress, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';

export const SDK_VERSION = '2.31.0';
export const TESTNET_RPC = 'https://fullnode.testnet.sui.io:443';
export const TESTNET_CHAIN = '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD';
export const SUI_TYPE = normalizeStructTag('0x2::sui::SUI');
export const USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
export const CLOCK = normalizeSuiAddress('0x6');
export const DEFAULT_GAS_BUDGET = 50_000_000n;
const gasCoinSpend = new WeakMap<Transaction, bigint>();
/** Declare template withdrawals from tx.gas, which are additional to the reserved gas budget. */
export function reserveGasCoinSpend(tx: Transaction, amount: bigint) {
  assert(amount > 0n && amount <= 500_000_000n, 'Gas coin spend exceeds this testnet starter limit');
  const total = (gasCoinSpend.get(tx) ?? 0n) + amount;
  assert(total <= 500_000_000n, 'Combined gas coin spend exceeds this testnet starter limit');
  gasCoinSpend.set(tx, total);
}
export const RECEIPT_INCLUDE = { effects: true, events: true, balanceChanges: true, objectTypes: true, transaction: true } as const;
export type ProvenTransaction = SuiClientTypes.Transaction<typeof RECEIPT_INCLUDE>;
export interface RecordedTransaction { label: string; digest: string; transaction: ProvenTransaction }
export interface ScenarioContext {
  client: SuiGrpcClient;
  packageId: string;
  payer: Ed25519Keypair;
  recipient: Ed25519Keypair;
  sponsor: Ed25519Keypair;
  execute(label: string, transaction: Transaction, sender: Ed25519Keypair, gasSponsor?: Ed25519Keypair): Promise<RecordedTransaction>;
  save(scenario: 'payments' | 'defi', evidence: Record<string, unknown>): Promise<void>;
}

export class NotProvenError extends Error {
  constructor(message: string) { super(`NOT PROVEN: ${message}`); this.name = 'NotProvenError'; }
}
export function createClient(url = TESTNET_RPC) {
  const parsed = new URL(url);
  assert(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)), 'Expected HTTPS or loopback Sui gRPC');
  assert(!parsed.username && !parsed.password && !parsed.hash, 'Invalid Sui endpoint');
  return new SuiGrpcClient({ network: 'testnet', baseUrl: url });
}
export function json(value: unknown) {
  return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item instanceof Uint8Array ? { encoding: 'base64', data: Buffer.from(item).toString('base64') } : item, 2);
}
export function address(input: string) {
  assert(isValidSuiAddress(input), 'Invalid Sui address');
  const value = normalizeSuiAddress(input); assert(BigInt(value) !== 0n, 'Zero address is not permitted'); return value;
}
export async function assertTestnet(client: SuiGrpcClient) {
  const { chainIdentifier } = await client.getChainIdentifier();
  assert.equal(chainIdentifier, TESTNET_CHAIN, 'Refusing a network other than the pinned public Sui Testnet');
  return chainIdentifier;
}
export async function balance(client: SuiGrpcClient, owner: string, coinType = SUI_TYPE) {
  const result = await client.getBalance({ owner: address(owner), coinType });
  assert(/^[0-9]+$/.test(result.balance.balance), 'Invalid chain balance'); return BigInt(result.balance.balance);
}
/** Select an actual owned coin object; no address-balance or implicit gas withdrawal. */
export async function selectCoin(client: SuiGrpcClient, owner: string, coinType: string, minimum: bigint): Promise<SuiClientTypes.Coin> {
  assert(minimum > 0n, 'Coin minimum must be positive');
  let cursor: string | null | undefined; const coins: SuiClientTypes.Coin[] = [];
  for (let page = 0; page < 20; page++) {
    const result = await client.listCoins({ owner: address(owner), coinType, limit: 100, cursor });
    coins.push(...result.objects.filter(coin => BigInt(coin.balance) >= minimum));
    if (coins.length || !result.hasNextPage) break;
    assert(result.cursor && result.cursor !== cursor, 'Coin pagination did not advance'); cursor = result.cursor;
  }
  const selected = coins.sort((a, b) => BigInt(a.balance) > BigInt(b.balance) ? -1 : BigInt(a.balance) < BigInt(b.balance) ? 1 : 0)[0];
  if (!selected) throw new NotProvenError(`No owned ${coinType} coin with at least ${minimum} atomic units for ${owner}`);
  return selected;
}
/** All callers construct bounded local templates. No public arbitrary-transaction sponsorship API. */
export async function prepareTransaction(client: SuiGrpcClient, tx: Transaction, sender: Ed25519Keypair, gasSponsor = sender) {
  await assertTestnet(client);
  const senderAddress = address(sender.toSuiAddress()); const sponsorAddress = address(gasSponsor.toSuiAddress());
  const data = tx.getData();
  assert(!data.sender || address(data.sender) === senderAddress, 'Transaction sender mismatch');
  assert(!data.gasData.owner || address(data.gasData.owner) === sponsorAddress, 'Gas owner mismatch');
  const budget = BigInt(data.gasData.budget ?? DEFAULT_GAS_BUDGET);
  assert(budget > 0n && budget <= 500_000_000n, 'Gas budget exceeds this testnet starter limit');
  // Sui removes the complete gas budget before executing PTB commands.
  const gas = await selectCoin(client, sponsorAddress, SUI_TYPE, budget + (gasCoinSpend.get(tx) ?? 0n));
  tx.setSender(senderAddress); tx.setGasOwner(sponsorAddress); tx.setGasBudget(budget);
  tx.setGasPayment([{ objectId: gas.objectId, version: gas.version, digest: gas.digest }]);
  const { referenceGasPrice } = await client.getReferenceGasPrice();
  assert(/^[0-9]+$/.test(referenceGasPrice) && BigInt(referenceGasPrice) > 0n, 'Invalid reference gas price');
  tx.setGasPrice(referenceGasPrice);
  return tx.build({ client });
}
export async function signAndExecute(client: SuiGrpcClient, label: string, tx: Transaction, sender: Ed25519Keypair, gasSponsor = sender): Promise<RecordedTransaction> {
  const bytes = await prepareTransaction(client, tx, sender, gasSponsor);
  const user = await sender.signTransaction(bytes);
  const signatures = [user.signature];
  if (sender.toSuiAddress() !== gasSponsor.toSuiAddress()) signatures.push((await gasSponsor.signTransaction(bytes)).signature);
  const result = await client.executeTransaction({ transaction: bytes, signatures, include: RECEIPT_INCLUDE });
  if (result.$kind === 'FailedTransaction') throw new Error(`${label} failed: ${result.FailedTransaction.status.error?.message}`);
  const final = await client.waitForTransaction({ result, include: RECEIPT_INCLUDE, timeout: 45_000 });
  assert.equal(final.$kind, 'Transaction', `${label} failed after execution`);
  const transaction = final.Transaction!;
  assert(transaction.status.success && transaction.effects.status.success, 'Receipt does not prove success');
  assert.equal(transaction.transaction.sender, sender.toSuiAddress(), 'Executed sender mismatch');
  assert.equal(transaction.transaction.gasData.owner, gasSponsor.toSuiAddress(), 'Executed gas sponsor mismatch');
  assert.equal(transaction.signatures.length, signatures.length, 'Executed signature count mismatch');
  return { label, digest: transaction.digest, transaction };
}
/** Require the intended Move abort; transport, gas, object and signature failures do not pass. */
export async function expectMoveAbort(ctx: ScenarioContext, tx: Transaction, caller: Ed25519Keypair, code: bigint, label: string) {
  const bytes = await prepareTransaction(ctx.client, tx, caller, ctx.sponsor);
  const result = await ctx.client.simulateTransaction({ transaction: bytes, checksEnabled: true, include: { effects: true } });
  assert.equal(result.$kind, 'FailedTransaction', `${label} unexpectedly succeeded`);
  const error = result.FailedTransaction!.status.error;
  assert(error && error.$kind === 'MoveAbort', `${label} did not fail with a Move abort`);
  assert.equal(BigInt(error.MoveAbort.abortCode), code, `${label} has the wrong abort code`);
  assert.equal(normalizeSuiAddress(error.MoveAbort.location?.package ?? '0x0'), address(ctx.packageId), `${label} aborted in another package`);
  assert.equal(error.MoveAbort.location?.module, 'escrow', `${label} aborted in another module`);
  return { label, kind: 'simulation-rejection', checksEnabled: true, code: code.toString(), error };
}
export function createdObjectId(proof: RecordedTransaction, expectedType: string) {
  const ids = proof.transaction.effects.changedObjects.filter(object => object.idOperation === 'Created' &&
    proof.transaction.objectTypes[object.objectId] && normalizeStructTag(proof.transaction.objectTypes[object.objectId]!) === normalizeStructTag(expectedType));
  assert.equal(ids.length, 1, `Expected one created ${expectedType}`); return ids[0]!.objectId;
}
export function findEvent(proof: RecordedTransaction, eventType: string) {
  const events = proof.transaction.events.filter(event => normalizeStructTag(event.eventType) === normalizeStructTag(eventType));
  assert.equal(events.length, 1, `Expected one ${eventType} event`); return events[0]!;
}
export function balanceDelta(proof: RecordedTransaction, owner: string, coinType: string) {
  return proof.transaction.balanceChanges.filter(change => normalizeSuiAddress(change.address) === address(owner) && normalizeStructTag(change.coinType) === normalizeStructTag(coinType))
    .reduce((total, change) => total + BigInt(change.amount), 0n);
}
const ClockSchema = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() });
export async function clockTime(client: SuiGrpcClient) {
  const { object } = await client.getObject({ objectId: CLOCK, include: { content: true } });
  assert.equal(normalizeStructTag(object.type), normalizeStructTag('0x2::clock::Clock'));
  return BigInt(ClockSchema.parse(object.content).timestamp_ms);
}
export async function waitForChainTime(client: SuiGrpcClient, timestampMs: bigint) {
  const end = Date.now() + 45_000;
  while (await clockTime(client) < timestampMs) {
    assert(Date.now() < end, 'Sui clock did not reach the refund deadline within 45 seconds');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
