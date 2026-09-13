// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, getAddress, toHex, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { namehash } from 'viem/ens';
import manifest from '../addresses.json';
import {
  addresses, ALL_ROLES, buildAuthorizeTextCall, buildCommitCall, buildDeployProxyCall,
  buildRegisterCall, buildRegisterSubnameCall, buildResolverInitialization, buildSetAddrCall,
  buildSetTextCall, commitmentArgs, createEnsClient, dnsEncodeName, ensLabelhash, ensNamehash,
  factoryAbi, normalizeEnsLabel, normalizeEnsName, parseConfigValue, readEnsConfig,
  readEnsProfile, registrarAbi, requireAddress, resolverAbi, userRegistryAbi,
  type ConfigKey, type EnsReadClient, type Registration,
} from '../lib/ens';

const OWNER = getAddress('0x1234567890123456789012345678901234567890');
const DELEGATE = getAddress('0x2234567890123456789012345678901234567890');
const RESOLVER = getAddress('0x3234567890123456789012345678901234567890');
const SUBREGISTRY = getAddress('0x4234567890123456789012345678901234567890');
const NAME = 'reader.tokyokits.eth';

function mockReadClient(overrides: { address?: Address | null; texts?: Partial<Record<ConfigKey, string | null>>; resolver?: Address } = {}) {
  const calls: Array<{ kind: string; parameters: Record<string, unknown> }> = [];
  let latestReads = 0;
  const texts: Record<ConfigKey, string | null> = { 'app:enabled': 'true', 'app:limit': '25', 'app:label': 'Tokyo Kit', ...overrides.texts };
  const capture = (kind: string, parameters: unknown) => { calls.push({ kind, parameters: parameters as Record<string, unknown> }); };
  // Only the RPC boundary is stubbed. Normalization, config policy and codecs are real.
  const client = {
    ...createEnsClient('http://127.0.0.1:1'),
    getChainId: async () => 11155111,
    getBlockNumber: async () => { latestReads++; return 12345n; },
    getEnsResolver: async (parameters: unknown) => { capture('resolver', parameters); return overrides.resolver ?? RESOLVER; },
    getEnsAddress: async (parameters: unknown) => { capture('address', parameters); return overrides.address === undefined ? OWNER : overrides.address; },
    getEnsText: async (parameters: { key: string }) => { capture('text', parameters); return texts[parameters.key as ConfigKey]; },
  } as unknown as EnsReadClient;
  return { client, calls, latestReads: () => latestReads };
}

describe('ENSv2 name and configuration boundaries', () => {
  test('normalizes case and encodes DNS/namehash using real ENS helpers', () => {
    expect(normalizeEnsName('Reader.TokyoKits.ETH')).toBe(NAME);
    expect(normalizeEnsLabel('TokyoKits')).toBe('tokyokits');
    expect(dnsEncodeName('A.eth')).toBe('0x01610365746800');
    expect(ensNamehash(NAME)).toBe(namehash(NAME));
    expect(ensLabelhash('TOKYOKITS')).toBe(ensLabelhash('tokyokits'));
    expect(dnsEncodeName('café.eth')).toBe('0x05636166c3a90365746800');
  });

  test('rejects missing, ambiguous, non-.eth and excessive name inputs', () => {
    for (const input of [null, undefined, 1, '', '.eth', 'eth', 'a..eth', ' a.eth', 'a.eth ', 'a.eth.', 'a.com', '\u0000.eth', `${'a'.repeat(256)}.eth`]) {
      expect(() => normalizeEnsName(input)).toThrow();
    }
    for (const input of ['a.b', '', ' a', 'a ']) expect(() => normalizeEnsLabel(input)).toThrow();
  });

  test('config parsing permits only bounded explicit values and nonzero addresses', () => {
    expect(parseConfigValue('app:enabled', 'false')).toBe('false');
    expect(parseConfigValue('app:limit', '0')).toBe('0');
    expect(parseConfigValue('app:limit', '1000')).toBe('1000');
    for (const value of [null, undefined, true, 'TRUE', '1', ' true']) expect(() => parseConfigValue('app:enabled', value)).toThrow();
    for (const value of ['-1', '01', '+1', '1.0', '1e2', '1001', ' 5', null]) expect(() => parseConfigValue('app:limit', value)).toThrow();
    for (const value of ['', ' leading', 'trailing ', 'x\ny', 'x'.repeat(81), null]) expect(() => parseConfigValue('app:label', value)).toThrow();
    for (const address of [null, zeroAddress, '0x123', 'example.eth']) expect(() => requireAddress(address)).toThrow();
  });

  test('all profile reads share the caller-provided block and official Universal Resolver', async () => {
    const { client, calls, latestReads } = mockReadClient();
    const result = await readEnsConfig(client, 'READER.TOKYOKITS.ETH', { blockNumber: 54321n });
    expect(result).toEqual({ name: NAME, blockNumber: '54321', resolver: RESOLVER, recipient: OWNER, enabled: true, limit: 25, label: 'Tokyo Kit' });
    expect(latestReads()).toBe(0);
    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.parameters.name).toBe(NAME);
      expect(call.parameters.blockNumber).toBe(54321n);
      expect(call.parameters.universalResolverAddress).toBe(addresses.UpgradableUniversalResolverProxy);
    }
  });

  test('chooses one block when omitted and exposes the unmodified profile records', async () => {
    const { client, calls, latestReads } = mockReadClient({ texts: { 'app:enabled': 'false' } });
    const profile = await readEnsProfile(client, NAME);
    expect(profile.texts['app:enabled']).toBe('false');
    expect(profile.node).toBe(ensNamehash(NAME));
    expect(latestReads()).toBe(1);
    expect(calls.every((call) => call.parameters.blockNumber === 12345n)).toBe(true);
  });

  test('missing or malformed resolved config fails closed without permissive fallbacks', async () => {
    for (const overrides of [
      { address: null }, { address: zeroAddress }, { resolver: zeroAddress },
      { texts: { 'app:enabled': null } }, { texts: { 'app:enabled': '1' } },
      { texts: { 'app:limit': '1001' } }, { texts: { 'app:label': '' } },
    ]) {
      await expect(readEnsConfig(mockReadClient(overrides).client, NAME)).rejects.toThrow();
    }
  });

  test('rejects the wrong chain or a CCIP-enabled client before name resolution', async () => {
    const first = mockReadClient();
    await expect(readEnsConfig({ ...first.client, ccipRead: undefined }, NAME)).rejects.toThrow('disable CCIP-Read');
    expect(first.calls.length).toBe(0);
    const second = mockReadClient();
    await expect(readEnsConfig({ ...second.client, getChainId: async () => 1 }, NAME)).rejects.toThrow('Sepolia');
    expect(second.calls.length).toBe(0);
  });
});

describe('unsigned calls against exact official ABIs', () => {
  test('registration calldata preserves commitment fields and inserts only the payment-token parameter', () => {
    const registration: Registration = { label: 'TOKYOKITS', owner: OWNER, secret: toHex(randomBytes(32)), subregistry: zeroAddress,
      resolver: RESOLVER, duration: 31536000n, referrer: zeroHash };
    const parameters = commitmentArgs(registration);
    const call = buildRegisterCall(registration, addresses.MockUSDC);
    const decoded = decodeFunctionData({ abi: registrarAbi, data: call.data });
    expect(call.to).toBe(addresses.ETHRegistrar); expect(call.value).toBe(0n);
    expect(decoded.functionName).toBe('register');
    expect(decoded.args).toEqual([...parameters.slice(0, 6), addresses.MockUSDC, parameters[6]]);
    expect(() => buildRegisterCall({ ...registration, resolver: zeroAddress }, addresses.MockUSDC)).toThrow();
    expect(() => buildRegisterCall({ ...registration, duration: 1n << 64n }, addresses.MockUSDC)).toThrow();
    expect(() => buildCommitCall('0x123' as Hex)).toThrow();
  });

  test('grant and revoke bind the DNS name, exact key and delegate in the supported authorization entrypoint', () => {
    for (const grant of [true, false]) {
      const call = buildAuthorizeTextCall(RESOLVER, NAME, 'app:limit', DELEGATE, grant);
      const decoded = decodeFunctionData({ abi: resolverAbi, data: call.data });
      expect(decoded.functionName).toBe('authorizeTextRoles');
      expect(decoded.args).toEqual([dnsEncodeName(NAME), 'app:limit', DELEGATE, grant]);
      expect(call.to).toBe(RESOLVER); expect(call.value).toBe(0n);
    }
    expect(() => buildAuthorizeTextCall(RESOLVER, NAME, 'app:limit', zeroAddress, true)).toThrow();
  });

  test('record setters encode node hashes, while a factory proxy uses only the pinned implementation', () => {
    const setText = buildSetTextCall(RESOLVER, NAME, 'app:enabled', 'false');
    const setAddr = buildSetAddrCall(RESOLVER, NAME, OWNER);
    expect(decodeFunctionData({ abi: resolverAbi, data: setText.data }).args).toEqual([ensNamehash(NAME), 'app:enabled', 'false']);
    expect(decodeFunctionData({ abi: resolverAbi, data: setAddr.data }).args).toEqual([ensNamehash(NAME), OWNER]);
    const initialization = buildResolverInitialization(OWNER, ALL_ROLES, [setText.data, setAddr.data]);
    expect(decodeFunctionData({ abi: resolverAbi, data: initialization }).args).toEqual([OWNER, ALL_ROLES, [setText.data, setAddr.data]]);
    const deploy = buildDeployProxyCall(addresses.PermissionedResolverImpl, 7n, initialization);
    expect(deploy.to).toBe(addresses.VerifiableFactory);
    expect(decodeFunctionData({ abi: factoryAbi, data: deploy.data }).args).toEqual([addresses.PermissionedResolverImpl, 7n, initialization]);
    expect(() => buildDeployProxyCall(RESOLVER, 7n, initialization)).toThrow('pinned official');
    expect(() => buildSetTextCall(RESOLVER, NAME, 'app:limit', '1001')).toThrow();
  });

  test('subname registration keeps absolute uint64 expiry and the selected resolver', () => {
    const call = buildRegisterSubnameCall(SUBREGISTRY, 'READER', DELEGATE, RESOLVER, ALL_ROLES, 2000000000n);
    expect(call.to).toBe(SUBREGISTRY);
    expect(decodeFunctionData({ abi: userRegistryAbi, data: call.data }).args).toEqual(['reader', DELEGATE, zeroAddress, RESOLVER, ALL_ROLES, 2000000000n]);
    expect(() => buildRegisterSubnameCall(SUBREGISTRY, 'reader', DELEGATE, RESOLVER, ALL_ROLES, -1n)).toThrow();
  });
});

test('every vendored ABI matches its pinned deployment manifest hash and source URL', () => {
  expect(manifest.sourceCommit).toBe('97a57293f3b4279d94b571e678edb53ce62638f4');
  for (const [name, artifact] of Object.entries(manifest.artifacts)) {
    const raw = readFileSync(new URL(`../abi/${name}.json`, import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(artifact.abiSha256);
    expect(artifact.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.source).toBe(`https://raw.githubusercontent.com/ensdomains/contracts-v2/${manifest.sourceCommit}/contracts/deployments/sepolia/${name}.json`);
    expect(Array.isArray(JSON.parse(raw.toString()))).toBe(true);
  }
});
