// SPDX-License-Identifier: MIT
// Offline SDK/RPC fixtures only. These tests are not testnet receipts or execution evidence.
import { describe, expect, spyOn, test } from 'bun:test';
import { strict as assert } from 'node:assert';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiClientTypes } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  assertTestnet, balanceDelta, createClient, createdObjectId, DEFAULT_GAS_BUDGET,
  expectMoveAbort, findEvent, NotProvenError, prepareTransaction, reserveGasCoinSpend,
  selectCoin, signAndExecute, SUI_TYPE, TESTNET_CHAIN, USDC_TYPE,
  type ProvenTransaction, type RecordedTransaction, type ScenarioContext,
} from '../lib/client';

const OWNER = normalizeSuiAddress('0xa11');
const OTHER = normalizeSuiAddress('0xb22');
const PACKAGE = normalizeSuiAddress('0xc33');
const FOREIGN_PACKAGE = normalizeSuiAddress('0xd44');
const DIGEST = '11111111111111111111111111111111';
const BYTES = Uint8Array.of(0); // Never signed or submitted; only consumed by explicit simulation fixtures.

/** Cast is confined to the external RPC fixture boundary; unexpected calls always fail. */
function offlineClient(methods: Partial<Record<keyof SuiGrpcClient, unknown>>): SuiGrpcClient {
  return new Proxy(methods, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      throw new Error(`Unexpected offline RPC access: ${String(property)}`);
    },
  }) as SuiGrpcClient;
}
function coin(amount: bigint, owner = OWNER, id = normalizeSuiAddress('0xe55'), coinType = SUI_TYPE): SuiClientTypes.Coin {
  return { objectId: id, version: '1', digest: DIGEST, owner: { $kind: 'AddressOwner', AddressOwner: owner },
    type: normalizeStructTag(`0x2::coin::Coin<${coinType}>`), balance: amount.toString() };
}
function fundedClient(owner: string, amount = DEFAULT_GAS_BUDGET, extra: Partial<Record<keyof SuiGrpcClient, unknown>> = {}) {
  return offlineClient({
    getChainIdentifier: async () => ({ chainIdentifier: TESTNET_CHAIN }),
    listCoins: async () => ({ objects: [coin(amount, owner)], hasNextPage: false, cursor: null }),
    getReferenceGasPrice: async () => ({ referenceGasPrice: '1000' }),
    ...extra,
  });
}
function changed(objectId: string, idOperation: SuiClientTypes.ChangedObject['idOperation'] = 'Created'): SuiClientTypes.ChangedObject {
  return { objectId, inputState: 'DoesNotExist', inputVersion: null, inputDigest: null, inputOwner: null,
    outputState: 'ObjectWrite', outputVersion: '1', outputDigest: DIGEST,
    outputOwner: { $kind: 'Immutable', Immutable: true }, idOperation };
}
function event(eventType: string, packageId = PACKAGE): SuiClientTypes.Event {
  return { packageId, module: 'payments', sender: OWNER, eventType, bcs: Uint8Array.of(1), json: null };
}
function receipt(overrides: Partial<ProvenTransaction> = {}): RecordedTransaction {
  const transaction: ProvenTransaction = {
    digest: DIGEST, signatures: [], epoch: '1', timestampMs: 1, checkpoint: '1', status: { success: true, error: null },
    bcs: undefined, balanceChanges: [], events: [], objectTypes: {},
    effects: { bcs: null, version: 2, status: { success: true, error: null },
      gasUsed: { computationCost: '0', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: DIGEST, gasObject: null, eventsDigest: null, dependencies: [], lamportVersion: null,
      changedObjects: [], unchangedConsensusObjects: [], auxiliaryDataDigest: null },
    transaction: { version: 2, sender: OWNER, expiration: null, inputs: [], commands: [],
      gasData: { budget: '1', price: '1', owner: OWNER, payment: [] } },
    ...overrides,
  };
  return { label: 'offline fixture — not execution evidence', digest: DIGEST, transaction };
}

describe('network and owned-coin preflight', () => {
  test('requires the complete pinned testnet genesis, and preserves transport failures', async () => {
    const correct = offlineClient({ getChainIdentifier: async () => ({ chainIdentifier: TESTNET_CHAIN }) });
    expect(await assertTestnet(correct)).toBe(TESTNET_CHAIN);
    await expect(assertTestnet(offlineClient({ getChainIdentifier: async () => ({ chainIdentifier: 'testnet' }) }))).rejects.toThrow('pinned public Sui Testnet');
    const transportError = new Error('offline transport fixture');
    await expect(assertTestnet(offlineClient({ getChainIdentifier: async () => { throw transportError; } }))).rejects.toBe(transportError);
  });

  test('rejects remote plaintext, embedded credentials and fragments before RPC', () => {
    for (const url of ['http://example.com:443', 'https://user:password@example.com', 'https://example.com/#fragment']) {
      expect(() => createClient(url)).toThrow();
    }
    expect(createClient('http://127.0.0.1:9000')).toBeDefined();
  });

  test('paginates with the exact owner/type and preserves amounts above Number precision', async () => {
    const minimum = 9_007_199_254_740_993n;
    const selected = coin(minimum, OWNER, normalizeSuiAddress('0xe56'), USDC_TYPE);
    const calls: Array<{ owner: string; coinType: string; limit: number; cursor?: string | null }> = [];
    const client = offlineClient({ listCoins: async (request: typeof calls[number]) => {
      calls.push(request);
      return request.cursor === 'next-page'
        ? { objects: [selected], hasNextPage: false, cursor: null }
        : { objects: [coin(minimum - 1n, OWNER, normalizeSuiAddress('0xe55'), USDC_TYPE)], hasNextPage: true, cursor: 'next-page' };
    } });
    expect(await selectCoin(client, OWNER, USDC_TYPE, minimum)).toBe(selected);
    expect(calls).toEqual([
      { owner: OWNER, coinType: USDC_TYPE, limit: 100, cursor: undefined },
      { owner: OWNER, coinType: USDC_TYPE, limit: 100, cursor: 'next-page' },
    ]);
  });

  test('stops on a repeated pagination cursor, and reports insufficient funds as not proven', async () => {
    const repeated = offlineClient({ listCoins: async () => ({ objects: [], hasNextPage: true, cursor: 'same' }) });
    await expect(selectCoin(repeated, OWNER, SUI_TYPE, 1n)).rejects.toThrow('pagination did not advance');
    await expect(selectCoin(fundedClient(OWNER, 99n), OWNER, SUI_TYPE, 100n)).rejects.toBeInstanceOf(NotProvenError);
    await expect(selectCoin(offlineClient({}), OWNER, SUI_TYPE, 0n)).rejects.toThrow('minimum must be positive');
  });
});

describe('signing boundary', () => {
  const cases = [
    { name: 'wrong chain', configure: (_tx: Transaction) => {}, chain: 'other-genesis', message: 'pinned public Sui Testnet' },
    { name: 'different sender', configure: (tx: Transaction) => tx.setSender(OTHER), message: 'sender mismatch' },
    { name: 'different gas owner', configure: (tx: Transaction) => tx.setGasOwner(OTHER), message: 'Gas owner mismatch' },
    { name: 'zero budget', configure: (tx: Transaction) => tx.setGasBudget(0), message: 'Gas budget exceeds' },
    { name: 'excessive budget', configure: (tx: Transaction) => tx.setGasBudget(500_000_001n), message: 'Gas budget exceeds' },
  ];
  for (const entry of cases) test(`refuses ${entry.name} before coin RPC, signing or submission`, async () => {
    const sender = Ed25519Keypair.generate(); const sponsor = Ed25519Keypair.generate();
    const userSign = spyOn(sender, 'signTransaction'); const sponsorSign = spyOn(sponsor, 'signTransaction');
    const tx = new Transaction(); entry.configure(tx); const build = spyOn(tx, 'build');
    const client = offlineClient({ getChainIdentifier: async () => ({ chainIdentifier: entry.chain ?? TESTNET_CHAIN }) });
    try {
      await expect(signAndExecute(client, 'offline refusal', tx, sender, sponsor)).rejects.toThrow(entry.message);
      expect(userSign).not.toHaveBeenCalled(); expect(sponsorSign).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
    } finally { userSign.mockRestore(); sponsorSign.mockRestore(); build.mockRestore(); }
  });

  test('requires gas budget plus the escrow withdrawal before building or signing', async () => {
    const sender = Ed25519Keypair.generate(); const deposit = 1_000_000n;
    const tx = new Transaction(); tx.splitCoins(tx.gas, [deposit]); reserveGasCoinSpend(tx, deposit);
    const sign = spyOn(sender, 'signTransaction'); const build = spyOn(tx, 'build');
    try {
      await expect(signAndExecute(fundedClient(sender.toSuiAddress(), DEFAULT_GAS_BUDGET + deposit - 1n), 'underfunded escrow', tx, sender)).rejects.toBeInstanceOf(NotProvenError);
      expect(sign).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
      build.mockResolvedValue(BYTES);
      expect(await prepareTransaction(fundedClient(sender.toSuiAddress(), DEFAULT_GAS_BUDGET + deposit), tx, sender)).toEqual(BYTES);
      expect(tx.getData().gasData.budget).toBe(DEFAULT_GAS_BUDGET.toString());
      expect(sign).not.toHaveBeenCalled();
    } finally { sign.mockRestore(); build.mockRestore(); }
  });

  test('accumulates declared gas withdrawals and bounds the total reserve', async () => {
    const sender = Ed25519Keypair.generate(); const tx = new Transaction();
    reserveGasCoinSpend(tx, 1_000_000n); reserveGasCoinSpend(tx, 2_000_000n);
    await expect(prepareTransaction(fundedClient(sender.toSuiAddress(), DEFAULT_GAS_BUDGET + 2_999_999n), tx, sender)).rejects.toBeInstanceOf(NotProvenError);
    expect(() => reserveGasCoinSpend(tx, -1n)).toThrow('Gas coin spend');
    expect(() => reserveGasCoinSpend(tx, 500_000_000n)).toThrow('Combined gas coin spend');
  });
});

describe('receipt provenance parsers', () => {
  const paymentType = `${PACKAGE}::payments::Payment<${USDC_TYPE}>`;
  const receiptType = `${PACKAGE}::payments::Receipt<${USDC_TYPE}>`;

  test('matches the full event type including defining package and asset, and rejects duplicates', () => {
    const intended = event(paymentType);
    const proof = receipt({ events: [event(`${FOREIGN_PACKAGE}::payments::Payment<${USDC_TYPE}>`, FOREIGN_PACKAGE), event(`${PACKAGE}::payments::Payment<${SUI_TYPE}>`), intended] });
    expect(findEvent(proof, paymentType)).toBe(intended);
    expect(() => findEvent(receipt({ events: proof.transaction.events.slice(0, 2) }), paymentType)).toThrow('Expected one');
    expect(() => findEvent(receipt({ events: [intended, intended] }), paymentType)).toThrow('Expected one');
  });

  test('requires exactly one newly created receipt of the complete expected type', () => {
    const correctId = normalizeSuiAddress('0xf1'); const foreignId = normalizeSuiAddress('0xf2'); const mutatedId = normalizeSuiAddress('0xf3');
    const proof = receipt();
    proof.transaction.effects.changedObjects = [changed(correctId), changed(foreignId), changed(mutatedId, 'None')];
    proof.transaction.objectTypes = { [correctId]: receiptType, [foreignId]: `${FOREIGN_PACKAGE}::payments::Receipt<${USDC_TYPE}>`, [mutatedId]: receiptType };
    expect(createdObjectId(proof, receiptType)).toBe(correctId);
    proof.transaction.effects.changedObjects[0]!.idOperation = 'None';
    expect(() => createdObjectId(proof, receiptType)).toThrow('Expected one created');
    proof.transaction.effects.changedObjects[0]!.idOperation = 'Created';
    proof.transaction.effects.changedObjects[2]!.idOperation = 'Created';
    expect(() => createdObjectId(proof, receiptType)).toThrow('Expected one created');
  });

  test('isolates balance deltas by both owner and asset without Number rounding', () => {
    const proof = receipt({ balanceChanges: [
      { address: OWNER, coinType: USDC_TYPE, amount: '9007199254740993' },
      { address: OWNER, coinType: USDC_TYPE, amount: '-1' },
      { address: OTHER, coinType: USDC_TYPE, amount: '700' },
      { address: OWNER, coinType: SUI_TYPE, amount: '-800' },
    ] });
    expect(balanceDelta(proof, OWNER, USDC_TYPE)).toBe(9_007_199_254_740_992n);
  });
});

describe('negative simulation classification', () => {
  function moveAbort(code = '5', packageId = PACKAGE, module = 'escrow'): SuiClientTypes.ExecutionError {
    return { $kind: 'MoveAbort', message: 'explicit offline MoveAbort fixture', MoveAbort: { abortCode: code, location: { package: packageId, module } } };
  }
  async function simulate(error: SuiClientTypes.ExecutionError | null, transportError?: Error) {
    const caller = Ed25519Keypair.generate(); const sponsor = Ed25519Keypair.generate(); const tx = new Transaction();
    const build = spyOn(tx, 'build').mockResolvedValue(BYTES);
    const client = fundedClient(sponsor.toSuiAddress(), DEFAULT_GAS_BUDGET, {
      simulateTransaction: async (input: { transaction: Uint8Array; checksEnabled?: boolean }) => {
        assert.deepEqual(input.transaction, BYTES); assert.equal(input.checksEnabled, true);
        if (transportError) throw transportError;
        const proof = receipt().transaction;
        if (!error) return { $kind: 'Transaction', Transaction: proof, commandResults: undefined };
        proof.status = { success: false, error }; proof.effects.status = proof.status;
        return { $kind: 'FailedTransaction', FailedTransaction: proof, commandResults: undefined };
      },
    });
    const context: ScenarioContext = { client, packageId: PACKAGE, payer: caller, recipient: Ed25519Keypair.generate(), sponsor,
      execute: async () => { throw new Error('Offline negative tests never execute'); },
      save: async () => { throw new Error('Offline fixtures are never saved as evidence'); } };
    try { return await expectMoveAbort(context, tx, caller, 5n, 'offline authorization test'); }
    finally { build.mockRestore(); }
  }

  test('accepts only the exact checked Move abort and marks it as a simulation', async () => {
    const result = await simulate(moveAbort());
    expect(result.kind).toBe('simulation-rejection'); expect(result.checksEnabled).toBe(true); expect(result.code).toBe('5');
  });
  test('refuses success, wrong abort code, wrong package and wrong module', async () => {
    await expect(simulate(null)).rejects.toThrow('unexpectedly succeeded');
    await expect(simulate(moveAbort('6'))).rejects.toThrow('wrong abort code');
    await expect(simulate(moveAbort('5', FOREIGN_PACKAGE))).rejects.toThrow('another package');
    await expect(simulate(moveAbort('5', PACKAGE, 'payments'))).rejects.toThrow('another module');
  });
  test('does not mislabel gas or transport errors as a successful negative check', async () => {
    await expect(simulate({ $kind: 'Unknown', Unknown: null, message: 'offline gas failure fixture' })).rejects.toThrow('did not fail with a Move abort');
    const transportError = new Error('offline unavailable transport');
    await expect(simulate(moveAbort(), transportError)).rejects.toBe(transportError);
  });
});
