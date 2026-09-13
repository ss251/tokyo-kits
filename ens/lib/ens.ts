// SPDX-License-Identifier: MIT
import {
  createPublicClient, defineChain, encodeFunctionData, getAddress, http, isAddress,
  toHex, zeroAddress, type Abi, type Address, type Hex, type PublicClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { labelhash, namehash, normalize, packetToBytes } from 'viem/ens';
import deployment from '../addresses.json';
import registrarArtifact from '../abi/ETHRegistrar.json';
import registryArtifact from '../abi/ETHRegistry.json';
import factoryArtifact from '../abi/VerifiableFactory.json';
import resolverArtifact from '../abi/PermissionedResolverImpl.json';
import userRegistryArtifact from '../abi/UserRegistryImpl.json';
import tokenArtifact from '../abi/MockUSDC.json';
import oracleArtifact from '../abi/StandardRentPriceOracle.json';
import universalArtifact from '../abi/UniversalResolverV2.json';

// The JSON arrays are verified against the pinned official deployment-source hashes.
export const registrarAbi = registrarArtifact as Abi;
export const registryAbi = registryArtifact as Abi;
export const factoryAbi = factoryArtifact as Abi;
export const resolverAbi = resolverArtifact as Abi;
export const userRegistryAbi = userRegistryArtifact as Abi;
export const erc20Abi = tokenArtifact as Abi;
export const oracleAbi = oracleArtifact as Abi;
export const universalResolverAbi = universalArtifact as Abi;
export const addresses = Object.freeze(Object.fromEntries(Object.entries(deployment.contracts)
  .map(([name, address]) => [name, getAddress(address)]))) as Readonly<Record<keyof typeof deployment.contracts, Address>>;

export const ensSepolia = defineChain({
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: addresses.UpgradableUniversalResolverProxy } },
});

export function createEnsClient(rpcUrl = deployment.defaultRpc) {
  const url = new URL(rpcUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid ENS RPC URL');
  return createPublicClient({
    chain: ensSepolia,
    // The API accepts arbitrary names, but never follows resolver-provided HTTP URLs.
    ccipRead: false,
    transport: http(rpcUrl, { timeout: 12_000, retryCount: 1, fetchOptions: { headers: { 'User-Agent': 'tokyo-kits/0.1' } } }),
  });
}

export type EnsReadClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getEnsResolver' | 'getEnsAddress' | 'getEnsText' | 'readContract' | 'ccipRead'>;
export interface ReadOptions { blockNumber?: bigint }
export const CONFIG_KEYS = ['app:enabled', 'app:limit', 'app:label'] as const;
export type ConfigKey = typeof CONFIG_KEYS[number];
export const MAX_CONFIG_LIMIT = 1000;

export interface EnsProfile {
  name: string;
  node: Hex;
  dnsName: Hex;
  blockNumber: string;
  resolver: Address;
  address: Address | null;
  texts: Record<ConfigKey, string | null>;
}
export interface EnsConfig {
  name: string;
  blockNumber: string;
  resolver: Address;
  recipient: Address;
  enabled: boolean;
  limit: number;
  label: string;
}
export interface UnsignedCall { to: Address; data: Hex; value: 0n }

/** This starter supports normalized .eth names, including their subnames, with bounded DNS input. */
export function normalizeEnsName(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim() || input.length > 1024) throw new Error('Invalid ENS name');
  let normalized: string;
  try { normalized = normalize(input); } catch { throw new Error('Invalid ENS name'); }
  const labels = normalized.split('.');
  if (labels.length < 2 || labels.at(-1) !== 'eth') throw new Error('This ENSv2 starter resolves .eth names and subnames');
  const encoder = new TextEncoder();
  if (encoder.encode(normalized).length > 1024 || labels.some((label) => !label || encoder.encode(label).length > 255)) throw new Error('ENS name exceeds this starter’s DNS limits');
  return normalized;
}

export function normalizeEnsLabel(input: unknown): string {
  if (typeof input !== 'string' || input.includes('.')) throw new Error('Expected one ENS label, without .eth');
  const name = normalizeEnsName(`${input}.eth`);
  const result = name.slice(0, -4);
  if (result.includes('.')) throw new Error('Expected one ENS label');
  return result;
}

export function dnsEncodeName(name: string): Hex { return toHex(packetToBytes(normalizeEnsName(name))); }
export function ensNamehash(name: string): Hex { return namehash(normalizeEnsName(name)); }
export function ensLabelhash(label: string): Hex { return labelhash(normalizeEnsLabel(label)); }

export function requireAddress(value: unknown, allowZero = false): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || (!allowZero && BigInt(value) === 0n)) throw new Error('Expected a nonzero EVM address');
  return getAddress(value);
}
function uint(value: bigint, bits: number): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`Expected uint${bits}`);
  return value;
}
function bytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Expected bytes32');
  return value;
}
function bytes(value: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('Expected hex bytes');
  return value;
}

export function parseConfigValue(key: ConfigKey, value: unknown): string {
  if (!CONFIG_KEYS.includes(key) || typeof value !== 'string') throw new Error(`Missing or invalid ${key}`);
  if (key === 'app:enabled' && value !== 'true' && value !== 'false') throw new Error('app:enabled must be true or false');
  if (key === 'app:limit' && (!/^(0|[1-9][0-9]{0,3})$/.test(value) || Number(value) > MAX_CONFIG_LIMIT)) throw new Error('app:limit must be a canonical integer from 0 to 1000');
  if (key === 'app:label' && (value.length < 1 || [...value].length > 80 || value !== value.trim() || /[\x00-\x1f\x7f-\x9f]/.test(value))) throw new Error('app:label must contain 1–80 printable characters');
  return value;
}

async function snapshot(client: EnsReadClient, options: ReadOptions): Promise<bigint> {
  if (client.ccipRead !== false) throw new Error('ENS client must disable CCIP-Read for this on-chain-only adapter');
  if (await client.getChainId() !== deployment.chainId) throw new Error('ENSv2 beta requires Sepolia chain 11155111');
  const blockNumber = options.blockNumber ?? await client.getBlockNumber({ cacheTime: 0 });
  return uint(blockNumber, 256);
}

/** All resolver/address/text reads share an explicit block and the official Universal Resolver. */
export async function readEnsProfile(client: EnsReadClient, input: unknown, options: ReadOptions = {}): Promise<EnsProfile> {
  const name = normalizeEnsName(input);
  const blockNumber = await snapshot(client, options);
  const parameters = { name, blockNumber, universalResolverAddress: addresses.UpgradableUniversalResolverProxy };
  const [resolver, address, enabled, limit, label] = await Promise.all([
    client.getEnsResolver(parameters), client.getEnsAddress(parameters),
    ...CONFIG_KEYS.map((key) => client.getEnsText({ ...parameters, key })),
  ]);
  return { name, node: ensNamehash(name), dnsName: dnsEncodeName(name), blockNumber: blockNumber.toString(),
    resolver: requireAddress(resolver), address: address && BigInt(address) !== 0n ? requireAddress(address) : null,
    texts: { 'app:enabled': enabled ?? null, 'app:limit': limit ?? null, 'app:label': label ?? null } };
}

/** Missing or malformed config fails closed. Text records are never executed or fetched as URLs. */
export async function readEnsConfig(client: EnsReadClient, input: unknown, options: ReadOptions = {}): Promise<EnsConfig> {
  const profile = await readEnsProfile(client, input, options);
  return { name: profile.name, blockNumber: profile.blockNumber, resolver: profile.resolver, recipient: requireAddress(profile.address),
    enabled: parseConfigValue('app:enabled', profile.texts['app:enabled']) === 'true',
    limit: Number(parseConfigValue('app:limit', profile.texts['app:limit'])),
    label: parseConfigValue('app:label', profile.texts['app:label']) };
}

/** Unsigned calldata only. The caller owns simulation, gas, nonce, signing and receipt verification. */
function call(to: Address, abi: Abi, functionName: string, args: readonly unknown[]): UnsignedCall {
  return { to: requireAddress(to), data: encodeFunctionData({ abi, functionName, args }), value: 0n };
}

export function buildSetTextCall(resolver: Address, name: string, key: ConfigKey, value: string): UnsignedCall {
  return call(resolver, resolverAbi, 'setText', [ensNamehash(name), key, parseConfigValue(key, value)]);
}
export function buildSetAddrCall(resolver: Address, name: string, recipient: Address): UnsignedCall {
  return call(resolver, resolverAbi, 'setAddr', [ensNamehash(name), requireAddress(recipient)]);
}
export function buildAuthorizeTextCall(resolver: Address, name: string, key: ConfigKey, delegate: Address, grant: boolean): UnsignedCall {
  if (!CONFIG_KEYS.includes(key) || typeof grant !== 'boolean') throw new Error('Invalid text delegation');
  return call(resolver, resolverAbi, 'authorizeTextRoles', [dnsEncodeName(name), key, requireAddress(delegate), grant]);
}
export function buildResolverInitialization(admin: Address, roles: bigint, setters: readonly Hex[] = []): Hex {
  return encodeFunctionData({ abi: resolverAbi, functionName: 'initialize', args: [requireAddress(admin), uint(roles, 256), setters.map(bytes)] });
}
export function buildRegistryInitialization(admin: Address, roles: bigint): Hex {
  return encodeFunctionData({ abi: userRegistryAbi, functionName: 'initialize', args: [requireAddress(admin), uint(roles, 256)] });
}
export function buildDeployProxyCall(implementation: Address, salt: bigint, initialization: Hex): UnsignedCall {
  const official = [addresses.PermissionedResolverImpl, addresses.UserRegistryImpl];
  if (!official.includes(requireAddress(implementation))) throw new Error('Expected the pinned official resolver or registry implementation');
  return call(addresses.VerifiableFactory, factoryAbi, 'deployProxy', [implementation, uint(salt, 256), bytes(initialization)]);
}

export interface Registration {
  label: string;
  owner: Address;
  secret: Hex;
  subregistry: Address;
  resolver: Address;
  duration: bigint;
  referrer: Hex;
}
export function commitmentArgs(input: Registration): readonly [string, Address, Hex, Address, Address, bigint, Hex] {
  if (input.duration === 0n) throw new Error('Registration duration must be positive');
  return [normalizeEnsLabel(input.label), requireAddress(input.owner), bytes32(input.secret), requireAddress(input.subregistry, true),
    requireAddress(input.resolver), uint(input.duration, 64), bytes32(input.referrer)];
}
export async function readCommitment(client: EnsReadClient, input: Registration): Promise<Hex> {
  const blockNumber = await snapshot(client, {});
  const result = await client.readContract({ address: addresses.ETHRegistrar, abi: registrarAbi, functionName: 'makeCommitment', args: commitmentArgs(input), blockNumber });
  return bytes32(result as Hex);
}
export function buildCommitCall(commitment: Hex): UnsignedCall {
  return call(addresses.ETHRegistrar, registrarAbi, 'commit', [bytes32(commitment)]);
}
export function buildRegisterCall(input: Registration, paymentToken: Address): UnsignedCall {
  const [label, owner, secret, subregistry, resolver, duration, referrer] = commitmentArgs(input);
  return call(addresses.ETHRegistrar, registrarAbi, 'register', [label, owner, secret, subregistry, resolver, duration, requireAddress(paymentToken), referrer]);
}
export function buildTokenApprovalCall(token: Address, spender: Address, amount: bigint): UnsignedCall {
  return call(token, erc20Abi, 'approve', [requireAddress(spender), uint(amount, 256)]);
}
export function buildTestTokenMintCall(to: Address, amount: bigint): UnsignedCall {
  return call(addresses.MockUSDC, erc20Abi, 'mint', [requireAddress(to), uint(amount, 256)]);
}

export async function readRegistrationPrice(client: EnsReadClient, label: string, duration: bigint, paymentToken: Address, options: ReadOptions = {}) {
  const blockNumber = await snapshot(client, options);
  const price = await client.readContract({ address: addresses.ETHRegistrar, abi: registrarAbi, functionName: 'getRegisterPrice',
    args: [normalizeEnsLabel(label), uint(duration, 64), requireAddress(paymentToken)], blockNumber }) as readonly [bigint, bigint];
  const base = uint(price[0], 256); const premium = uint(price[1], 256);
  return { base, premium, total: uint(base + premium, 256), blockNumber };
}
export async function readCurrentTokenId(client: EnsReadClient, registry: Address, label: string, options: ReadOptions = {}): Promise<bigint> {
  const blockNumber = await snapshot(client, options);
  const tokenId = await client.readContract({ address: requireAddress(registry), abi: registryAbi, functionName: 'findTokenId', args: [normalizeEnsLabel(label)], blockNumber });
  return uint(tokenId as bigint, 256);
}
export function buildSetSubregistryCall(registry: Address, currentTokenId: bigint, subregistry: Address): UnsignedCall {
  return call(registry, registryAbi, 'setSubregistry', [uint(currentTokenId, 256), requireAddress(subregistry)]);
}
export function buildSetParentCall(subregistry: Address, parentRegistry: Address, parentLabel: string): UnsignedCall {
  return call(subregistry, userRegistryAbi, 'setParent', [requireAddress(parentRegistry), normalizeEnsLabel(parentLabel)]);
}
export function buildRegisterSubnameCall(registry: Address, label: string, owner: Address, resolver: Address, roles: bigint, expiry: bigint, subregistry: Address = zeroAddress): UnsignedCall {
  return call(registry, userRegistryAbi, 'register', [normalizeEnsLabel(label), requireAddress(owner), requireAddress(subregistry, true),
    requireAddress(resolver), uint(roles, 256), uint(expiry, 64)]);
}

/** Nybble-packed EAC role bits from the pinned official registry/resolver libraries. */
export const ALL_ROLES = BigInt(`0x${'1'.repeat(64)}`);
export const REGISTRAR_ROLE = 1n;
export const RENEW_ROLE = 1n << 16n;
export const SET_SUBREGISTRY_ROLE = 1n << 20n;
export const SET_RESOLVER_ROLE = 1n << 24n;
export const CAN_TRANSFER_ADMIN_ROLE = 1n << 156n;
export const SET_TEXT_ROLE = 1n << 4n;
export const roleAdmin = (role: bigint): bigint => uint(role, 128) << 128n;
