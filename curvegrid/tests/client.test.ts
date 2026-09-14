// SPDX-License-Identifier: MIT
// Offline official-SDK HTTP fixtures. No responses here are live MultiBaas evidence.
import { describe, expect, test } from 'bun:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress, keccak256, type Hex } from 'viem';
import { createMultiBaasAdapter, deploymentBasePath, MultiBaasRequestError, type CounterArtifact, type SdkHttp } from '../multibaas-basics/client';
import { COUNTER_ABI } from '../multibaas-basics/demo';
import { record, SEPOLIA_CHAIN_ID } from '../multibaas-basics/validation';

const ADDRESS = getAddress('0x1111111111111111111111111111111111111111');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const CONFIG = { baseUrl: 'https://offline-fixture.multibaas.com', adminApiKey: 'offline-admin-fixture', dappApiKey: 'offline-dapp-fixture' };
const ARTIFACT: CounterArtifact = { abi: COUNTER_ABI, bytecode: '0x60006000', deployedBytecode: '0x6000', immutableReferences: {} };
interface RequestFixture { path: string; method: string; data: unknown; headers: Record<string, unknown>; url: URL }
function transport(handler: (request: RequestFixture) => unknown) {
  const requests: RequestFixture[] = [];
  // The SDK itself creates the URL, headers, arguments and serialized JSON. Only Axios I/O is replaced.
  const http = { defaults: {}, request: async (input: unknown) => {
    const config = record(input, 'offline HTTP config'); const url = new URL(String(config.url));
    const request = { path: url.pathname, method: String(config.method), data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      headers: record(config.headers, 'offline headers'), url };
    requests.push(request);
    return { status: 200, data: { status: 200, message: 'explicit offline fixture', result: handler(request) } };
  } } as unknown as SdkHttp;
  return { http, requests };
}
function chain(chainID = SEPOLIA_CHAIN_ID) { return { chainID, networkID: SEPOLIA_CHAIN_ID, blockNumber: 100 }; }
function stored() { return { label: 'kit-counter', version: '1.0.0', contractName: 'KitCounter', rawAbi: JSON.stringify(ARTIFACT.abi), bin: ARTIFACT.bytecode }; }

describe('MultiBaas credential and transport boundaries', () => {
  test('missing credentials fail before HTTP, and deployment URLs cannot redirect credentials', () => {
    expect(() => createMultiBaasAdapter({ ...CONFIG, adminApiKey: '' })).toThrow('NOT PROVEN');
    for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?token=1', 'https://example.com#fragment']) {
      expect(() => deploymentBasePath(url)).toThrow();
    }
    expect(deploymentBasePath(`${CONFIG.baseUrl}/api/v0/`)).toBe(`${CONFIG.baseUrl}/api/v0`);
  });
  test('refuses another chain before any library mutation', async () => {
    const fixture = transport(() => chain(1)); const mb = createMultiBaasAdapter(CONFIG, fixture.http);
    await expect(mb.uploadCounter(ARTIFACT, 'kit-counter', '1.0.0')).rejects.toThrow('must use Sepolia');
    expect(fixture.requests).toHaveLength(1); expect(fixture.requests[0]!.method).toBe('GET');
  });
  test('does not retain API credentials from Axios errors', async () => {
    const fixture = transport(() => { throw { response: { status: 403 }, config: { headers: { Authorization: 'sensitive-fixture-value' } }, message: 'sensitive-fixture-value' }; });
    try { await createMultiBaasAdapter(CONFIG, fixture.http).chainStatus(); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(MultiBaasRequestError); expect(String(error)).toContain('HTTP 403');
      expect(String(error)).not.toContain('sensitive-fixture-value'); expect((error as Error).cause).toBeUndefined();
    }
  });
});

describe('current official SDK request flow', () => {
  test('uploads exact ABI/bytecode on 404 with administrator credentials', async () => {
    const fixture = transport(request => {
      if (request.path === '/api/v0/chains/ethereum/status') return chain();
      if (request.path === '/api/v0/contracts/kit-counter/1.0.0') throw { response: { status: 404 } };
      expect(request.path).toBe('/api/v0/contracts/kit-counter'); expect(request.method).toBe('POST');
      expect(request.headers.Authorization).toBe('Bearer offline-admin-fixture');
      expect(request.data).toEqual(stored()); return stored();
    });
    const result = await createMultiBaasAdapter(CONFIG, fixture.http).uploadCounter(ARTIFACT, 'kit-counter', '1.0.0');
    expect(result.bytecodeHash).toBe(keccak256(ARTIFACT.bytecode));
  });
  test('an existing version must match exactly and is never silently overwritten', async () => {
    const fixture = transport(request => request.path.endsWith('/chains/ethereum/status') ? chain() : { ...stored(), bin: '0x6001' });
    await expect(createMultiBaasAdapter(CONFIG, fixture.http).uploadCounter(ARTIFACT, 'kit-counter', '1.0.0')).rejects.toThrow('bytecode mismatch');
    expect(fixture.requests.every(request => request.method === 'GET')).toBe(true);
  });
  test('deployment is version pinned; increment uses current no-chain-argument signature and DApp key', async () => {
    const fixture = transport(request => {
      if (request.path.endsWith('/chains/ethereum/status')) return chain();
      const body = record(request.data, 'compose fixture');
      expect(body.from).toBe(ADDRESS); expect(body.nonce).toBe(9); expect(body.args).toEqual([]);
      expect(body.signAndSubmit).toBe(false); expect(body.nonceManagement).toBe(false); expect(body.value).toBe('0');
      if (request.path === '/api/v0/contracts/kit-counter/1.0.0/deploy') expect(request.headers.Authorization).toBe('Bearer offline-admin-fixture');
      else {
        expect(request.path).toBe(`/api/v0/chains/ethereum/addresses/${ADDRESS}/contracts/kit-counter/methods/increment`);
        expect(body.contractOverride).toBe(false); expect(request.headers.Authorization).toBe('Bearer offline-dapp-fixture');
      }
      return { tx: {}, submitted: false };
    });
    const mb = createMultiBaasAdapter(CONFIG, fixture.http);
    await mb.composeDeployment('kit-counter', '1.0.0', ADDRESS, 9); await mb.composeIncrement(ADDRESS, 'kit-counter', ADDRESS, 9);
  });
  test('linking records the real starting block and refuses an unrelated alias', async () => {
    const fixture = transport(request => {
      if (request.path.endsWith('/chains/ethereum/status')) return chain();
      if (request.method === 'GET') throw { response: { status: 404 } };
      if (request.path.endsWith('/addresses')) return { address: ADDRESS, alias: 'kit-alias' };
      expect(request.path).toBe(`/api/v0/chains/ethereum/addresses/${ADDRESS}/contracts`);
      expect(request.data).toEqual({ label: 'kit-counter', version: '1.0.0', startingBlock: '123' }); return undefined;
    });
    await createMultiBaasAdapter(CONFIG, fixture.http).linkCounter(ADDRESS, 'kit-alias', 'kit-counter', '1.0.0', 123n);
    const collision = transport(request => request.path.endsWith('/chains/ethereum/status') ? chain() : { address: OTHER });
    await expect(createMultiBaasAdapter(CONFIG, collision.http).linkCounter(ADDRESS, 'kit-alias', 'kit-counter', '1.0.0', 123n)).rejects.toThrow('unrelated address alias');
    expect(collision.requests.every(request => request.method === 'GET')).toBe(true);
  });
  test('SDK reads request lossless integers and event queries filter the exact transaction', async () => {
    const fixture = transport(request => {
      if (request.path.endsWith('/methods/value')) {
        expect(request.data).toEqual({ args: [], formatInts: 'as_strings', contractOverride: false }); return { kind: 'MethodCallResponse', output: '9007199254740993' };
      }
      expect(request.path).toBe('/api/v0/events');
      expect(request.url.searchParams.get('tx_hash')).toBe(HASH); expect(request.url.searchParams.get('contract_address')).toBe(ADDRESS);
      expect(request.url.searchParams.get('event_signature')).toBe('Incremented(address,uint256)');
      expect(request.url.searchParams.get('offset')).toBe('100'); return [];
    });
    const mb = createMultiBaasAdapter(CONFIG, fixture.http);
    expect(await mb.readCounter(ADDRESS, 'kit-counter')).toBe(9_007_199_254_740_993n); await mb.listCounterEvents(ADDRESS, 'kit-counter', HASH, 100);
  });
  test('SDK submission must return the locally computed signed transaction hash', async () => {
    const account = privateKeyToAccount(generatePrivateKey()); // Ephemeral offline key; never funded, printed, or saved.
    const signed = await account.signTransaction({ chainId: SEPOLIA_CHAIN_ID, type: 'legacy', nonce: 0, gas: 21_000n, gasPrice: 1n, to: ADDRESS, value: 0n });
    const fixture = transport(request => request.path.endsWith('/chains/ethereum/status') ? chain() : { tx: { hash: HASH } });
    await expect(createMultiBaasAdapter(CONFIG, fixture.http).submitSigned(signed)).rejects.toThrow('submitted hash mismatch');
  });
});
