// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { AddressesApi, ChainsApi, Configuration, ContractsApi, EventsApi, GetTransactionReceiptIncludeEnum } from '@curvegrid/multibaas-sdk';
import { keccak256, parseTransaction, type Abi, type Address, type Hex } from 'viem';
import { NotProvenError } from '../scripts/config';
import { evmAddress, hash, hexBytes, record, safeInteger, SEPOLIA_CHAIN_ID, validateReadOwner, validateReadValue, validateSdkReceipt } from './validation';

export const SDK_VERSION = '1.1.1';
export const SDK_COMMIT = '65f28a15e76f6e16feee7059301cb4fcf6b842d3';
export const COUNTER_EVENT = 'Incremented(address,uint256)';
export interface CounterArtifact {
  abi: Abi; bytecode: Hex; deployedBytecode: Hex;
  immutableReferences: Record<string, Array<{ start: number; length: number }>>;
}
export interface MultiBaasConfig { baseUrl: string; adminApiKey: string; dappApiKey: string }
export type SdkHttp = NonNullable<ConstructorParameters<typeof ContractsApi>[2]>;
export class MultiBaasRequestError extends Error {
  constructor(operation: string, readonly status?: number) {
    super(`MultiBaas ${operation} failed${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'MultiBaasRequestError';
  }
}
export function deploymentBasePath(input: string) {
  const url = new URL(input);
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'MultiBaas needs a clean HTTPS deployment URL');
  assert(url.pathname === '/' || url.pathname === '/api/v0' || url.pathname === '/api/v0/', 'Unexpected MultiBaas URL path');
  return `${url.origin}/api/v0`;
}
function label(input: string) { assert(/^[a-z][a-z0-9_-]{0,63}$/.test(input), 'Invalid counter label'); return input; }
function version(input: string) { assert(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(input), 'Expected an exact contract version'); return input; }
async function responseResult(promise: PromiseLike<{ status: number; data: unknown }>, operation: string): Promise<unknown> {
  let response: { status: number; data: unknown };
  try { response = await promise; }
  catch (error) {
    const status = typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: unknown } }).response?.status : undefined;
    // Never retain or print Axios errors: their request configuration contains API credentials.
    throw new MultiBaasRequestError(operation, typeof status === 'number' && Number.isSafeInteger(status) ? status : undefined);
  }
  assert(response.status >= 200 && response.status < 300, `Unexpected HTTP response for ${operation}`);
  const body = record(response.data, `${operation} response`);
  const status = safeInteger(body.status, 'MultiBaas status'); assert(status >= 200 && status < 300, `MultiBaas ${operation} did not succeed`);
  assert(typeof body.message === 'string', 'Invalid MultiBaas response message');
  return body.result;
}
function sameContract(input: unknown, artifact: CounterArtifact, contractLabel: string, contractVersion: string) {
  const stored = record(input, 'stored contract');
  assert.equal(stored.label, contractLabel, 'Stored contract label mismatch'); assert.equal(stored.version, contractVersion, 'Stored contract version mismatch');
  assert.equal(stored.contractName, 'KitCounter', 'Stored contract name mismatch');
  assert.equal(hexBytes(stored.bin, 'stored bytecode'), hexBytes(artifact.bytecode, 'local bytecode'), 'Stored creation bytecode mismatch');
  assert(typeof stored.rawAbi === 'string' && stored.rawAbi.length <= 200_000, 'Invalid stored ABI');
  assert.deepEqual(JSON.parse(stored.rawAbi), artifact.abi, 'Stored ABI mismatch');
  return { label: contractLabel, version: contractVersion, bytecodeHash: keccak256(artifact.bytecode) };
}
/** SDK calls are bounded to KitCounter; signing and independent RPC reconciliation belong to the runner. */
export function createMultiBaasAdapter(config: MultiBaasConfig, http?: SdkHttp) {
  if (!config.baseUrl || !config.adminApiKey || !config.dappApiKey) {
    throw new NotProvenError('Set MULTIBAAS_URL, MULTIBAAS_ADMIN_API_KEY and MULTIBAAS_API_KEY from a Sepolia MultiBaas deployment');
  }
  const basePath = deploymentBasePath(config.baseUrl);
  const configure = (key: string) => new Configuration({ basePath, accessToken: key,
    baseOptions: { timeout: 15_000, maxRedirects: 0, maxContentLength: 2_000_000, maxBodyLength: 2_000_000 } });
  const adminConfig = configure(config.adminApiKey); const dappConfig = configure(config.dappApiKey);
  const admin = new ContractsApi(adminConfig, undefined, http); const addresses = new AddressesApi(adminConfig, undefined, http);
  const contracts = new ContractsApi(dappConfig, undefined, http); const chains = new ChainsApi(dappConfig, undefined, http);
  const events = new EventsApi(dappConfig, undefined, http);
  async function chainStatus() {
    const status = record(await responseResult(chains.getChainStatus(), 'chain status'), 'chain status');
    assert.equal(safeInteger(status.chainID, 'chain ID'), SEPOLIA_CHAIN_ID, 'MultiBaas deployment must use Sepolia');
    return { chainId: SEPOLIA_CHAIN_ID, blockNumber: safeInteger(status.blockNumber, 'chain block'), networkId: safeInteger(status.networkID, 'network ID') };
  }
  return {
    chainStatus,
    async uploadCounter(artifact: CounterArtifact, contractLabel: string, contractVersion: string) {
      label(contractLabel); version(contractVersion); await chainStatus();
      hexBytes(artifact.bytecode, 'creation bytecode'); assert(artifact.bytecode !== '0x' && Array.isArray(artifact.abi), 'Counter artifact is empty');
      try { return sameContract(await responseResult(admin.getContractVersion(contractLabel, contractVersion), 'get contract'), artifact, contractLabel, contractVersion); }
      catch (error) { if (!(error instanceof MultiBaasRequestError) || error.status !== 404) throw error; }
      const result = await responseResult(admin.createContract(contractLabel, { label: contractLabel, contractName: 'KitCounter', version: contractVersion,
        rawAbi: JSON.stringify(artifact.abi), bin: artifact.bytecode }), 'upload contract');
      return sameContract(result, artifact, contractLabel, contractVersion);
    },
    async composeDeployment(contractLabel: string, contractVersion: string, from: Address, nonce: number) {
      label(contractLabel); version(contractVersion); await chainStatus();
      return responseResult(admin.deployContractVersion(contractLabel, contractVersion, { from: evmAddress(from, 'deployer'), nonce: safeInteger(nonce, 'nonce'),
        args: [], value: '0', signAndSubmit: false, nonceManagement: false }), 'compose deployment');
    },
    async linkCounter(address: Address, alias: string, contractLabel: string, contractVersion: string, startingBlock: bigint) {
      label(alias); label(contractLabel); version(contractVersion); await chainStatus(); assert(startingBlock >= 0n, 'Invalid starting block');
      const target = evmAddress(address, 'counter address');
      try {
        const existing = record(await responseResult(addresses.getAddress(alias), 'get address alias'), 'address alias');
        assert.equal(evmAddress(existing.address, 'stored alias address'), target, 'Refusing to overwrite an unrelated address alias');
      } catch (error) { if (!(error instanceof MultiBaasRequestError) || error.status !== 404) throw error; }
      await responseResult(addresses.setAddress({ address: target, alias }), 'set address alias');
      await responseResult(admin.linkAddressContract(target, { label: contractLabel, version: contractVersion, startingBlock: startingBlock.toString() }), 'link counter');
      return { address: target, alias, label: contractLabel, version: contractVersion, startingBlock: startingBlock.toString() };
    },
    async readCounter(address: Address, contractLabel: string) {
      return validateReadValue(await responseResult(contracts.callContractFunction(evmAddress(address, 'counter address'), label(contractLabel), 'value',
        { args: [], formatInts: 'as_strings', contractOverride: false }), 'read counter'));
    },
    async readOwner(address: Address, contractLabel: string) {
      return validateReadOwner(await responseResult(contracts.callContractFunction(evmAddress(address, 'counter address'), label(contractLabel), 'owner',
        { args: [], formatInts: 'as_strings', contractOverride: false }), 'read owner'));
    },
    async composeIncrement(address: Address, contractLabel: string, from: Address, nonce: number) {
      await chainStatus();
      return responseResult(contracts.callContractFunction(evmAddress(address, 'counter address'), label(contractLabel), 'increment',
        { from: evmAddress(from, 'sender'), nonce: safeInteger(nonce, 'nonce'), args: [], value: '0', signAndSubmit: false, nonceManagement: false, contractOverride: false }), 'compose increment');
    },
    async submitSigned(signedTx: Hex) {
      hexBytes(signedTx, 'signed transaction'); const transaction = parseTransaction(signedTx);
      assert.equal(transaction.chainId, SEPOLIA_CHAIN_ID, 'Signed transaction must use Sepolia'); assert.equal(transaction.value ?? 0n, 0n, 'Signed counter transaction must have zero value');
      await chainStatus(); const expected = keccak256(signedTx);
      const result = record(await responseResult(chains.submitSignedTransaction({ signedTx }), 'submit signed transaction'), 'signed submission');
      assert.equal(hash(record(result.tx, 'submitted transaction').hash, 'submitted hash'), expected, 'SDK submitted hash mismatch'); return expected;
    },
    async getReceipt(transactionHash: Hex) {
      const expected = hash(transactionHash, 'transaction hash');
      return validateSdkReceipt(await responseResult(chains.getTransactionReceipt(expected, GetTransactionReceiptIncludeEnum.Contract), 'get receipt'), expected);
    },
    async indexingStatus(address: Address, contractLabel: string) {
      // Observed 2026-09-17: a DApp User key receives HTTP 403 on indexing status; it is an administrator observability call.
      const result = record(await responseResult(admin.getEventIndexingStatus(evmAddress(address, 'counter address'), label(contractLabel)), 'indexing status'), 'indexing status');
      assert(typeof result.isProcessingPastLogs === 'boolean', 'Invalid indexing status');
      return { latestBlockNumber: safeInteger(result.latestBlockNumber, 'indexed block'), latestBlockHash: hash(result.latestBlockHash, 'indexed block hash'),
        startBlockNumber: safeInteger(result.startBlockNumber, 'index start block'), isProcessingPastLogs: result.isProcessingPastLogs };
    },
    // Observed 2026-09-17 against a live deployment: the SDK 1.1.1 `tx_hash` filter returned no rows for an
    // already indexed event, while the block-number filter returned it. The caller matches the hash itself.
    async listCounterEvents(address: Address, contractLabel: string, blockNumber: bigint, offset = 0) {
      assert(safeInteger(offset, 'event offset') <= 1000, 'Event pagination exceeds starter bound');
      const block = safeInteger(Number(blockNumber), 'event block number');
      const result = await responseResult(events.listEvents(undefined, block, undefined, undefined, undefined, false,
        evmAddress(address, 'counter address'), label(contractLabel), COUNTER_EVENT, 100, offset), 'list counter events');
      assert(Array.isArray(result) && result.length <= 100, 'Invalid event page'); return result as unknown[];
    },
  };
}
export type MultiBaasAdapter = ReturnType<typeof createMultiBaasAdapter>;
