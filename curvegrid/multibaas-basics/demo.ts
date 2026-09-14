// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { decodeEventLog, encodeDeployData, encodeFunctionData, getContractAddress, parseAbi, type Address, type Hex } from 'viem';
import { type CounterArtifact, type MultiBaasAdapter } from './client';
import { evmAddress, hash, record, SEPOLIA_CHAIN_ID, validateUnsignedTransaction, type RpcLog, type UnsignedIntent } from './validation';

export const COUNTER_ABI = parseAbi([
  'constructor()', 'function owner() view returns (address)', 'function value() view returns (uint256)',
  'function increment()', 'event Incremented(address indexed caller,uint256 value)', 'error Unauthorized(address caller)',
]);
export interface ConfirmedCall {
  hash: Hex; blockNumber: bigint; blockHash: Hex; contractAddress: Address | null; logs: readonly RpcLog[];
}
export interface ExecuteRequest { label: string; unsigned: unknown; intent: UnsignedIntent }
export interface BasicsContext {
  mb: MultiBaasAdapter; artifact: CounterArtifact; label: string; version: string; signer: Address;
  nextNonce(): Promise<number>;
  /** Must validate, locally sign, SDK-submit, and reconcile the independent Sepolia RPC receipt. */
  execute(request: ExecuteRequest): Promise<ConfirmedCall>;
  readValue(address: Address): Promise<bigint>;
  readOwner(address: Address): Promise<Address>;
  verifyRuntime(address: Address, artifact: CounterArtifact): Promise<void>;
  save(evidence: Record<string, unknown>): Promise<void>;
}
export function counterLog(proof: ConfirmedCall, address: Address, caller: Address, value: bigint): RpcLog {
  const matches = proof.logs.filter(log => evmAddress(log.address, 'log emitter') === evmAddress(address, 'counter'));
  assert.equal(matches.length, 1, 'Expected exactly one counter log'); const log = matches[0]!;
  assert(!log.removed && log.transactionHash && log.blockHash && log.blockNumber !== null && log.logIndex !== null, 'Counter log is not confirmed');
  assert.equal(hash(log.transactionHash, 'log transaction'), hash(proof.hash, 'proof hash')); assert.equal(hash(log.blockHash, 'log block'), hash(proof.blockHash, 'proof block'));
  assert.equal(log.blockNumber, proof.blockNumber);
  const decoded = decodeEventLog({ abi: COUNTER_ABI, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]], strict: true });
  assert.equal(decoded.eventName, 'Incremented'); assert.equal(evmAddress(decoded.args.caller, 'event caller'), evmAddress(caller, 'expected caller'));
  assert.equal(decoded.args.value, value, 'Counter event value mismatch'); return log;
}
export async function runBasics(ctx: BasicsContext) {
  const signer = evmAddress(ctx.signer, 'signer'); const status = await ctx.mb.chainStatus();
  const uploaded = await ctx.mb.uploadCounter(ctx.artifact, ctx.label, ctx.version);
  const deploymentNonce = await ctx.nextNonce();
  const deploymentUnsigned = await ctx.mb.composeDeployment(ctx.label, ctx.version, signer, deploymentNonce);
  const deploymentIntent: UnsignedIntent = { kind: 'deployment', chainId: SEPOLIA_CHAIN_ID, from: signer, to: null,
    nonce: deploymentNonce, data: encodeDeployData({ abi: ctx.artifact.abi, bytecode: ctx.artifact.bytecode, args: [] }) };
  validateUnsignedTransaction(deploymentUnsigned, deploymentIntent);
  const expectedAddress = getContractAddress({ from: signer, nonce: BigInt(deploymentNonce) });
  const proposedAddress = record(deploymentUnsigned, 'deployment response').deployAt;
  if (proposedAddress !== undefined) assert.equal(evmAddress(proposedAddress, 'proposed deployment address'), evmAddress(expectedAddress, 'expected deployment address'));
  const deployment = await ctx.execute({ label: 'MultiBaas-composed KitCounter deployment', unsigned: deploymentUnsigned, intent: deploymentIntent });
  assert(deployment.contractAddress, 'Deployment receipt has no contract address'); const address = evmAddress(deployment.contractAddress, 'deployed counter');
  assert.equal(address, evmAddress(expectedAddress, 'expected deployment address'), 'Deployed address mismatch');
  await ctx.verifyRuntime(address, ctx.artifact);
  assert.equal(evmAddress(await ctx.readOwner(address), 'RPC owner'), signer, 'Deployed owner mismatch');
  const alias = `counter-${address.slice(2, 14).toLowerCase()}`;
  const linked = await ctx.mb.linkCounter(address, alias, ctx.label, ctx.version, deployment.blockNumber);
  assert.equal(await ctx.mb.readOwner(address, ctx.label), signer, 'SDK owner mismatch');
  const before = await ctx.mb.readCounter(address, ctx.label); assert.equal(before, 0n, 'Fresh counter must start at zero');
  assert.equal(await ctx.readValue(address), before, 'SDK/RPC initial state mismatch');
  const incrementNonce = await ctx.nextNonce(); const unsigned = await ctx.mb.composeIncrement(address, ctx.label, signer, incrementNonce);
  const intent: UnsignedIntent = { kind: 'call', chainId: SEPOLIA_CHAIN_ID, from: signer, to: address, nonce: incrementNonce,
    data: encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' }), maxGas: 200_000n };
  validateUnsignedTransaction(unsigned, intent);
  const increment = await ctx.execute({ label: 'MultiBaas-composed owner increment', unsigned, intent });
  assert.equal(increment.contractAddress, null, 'Increment must not deploy a contract');
  const after = await ctx.mb.readCounter(address, ctx.label); assert.equal(after, before + 1n, 'SDK counter did not increment');
  assert.equal(await ctx.readValue(address), after, 'SDK/RPC final state mismatch');
  const event = counterLog(increment, address, signer, after);
  const result = { address, signer, label: ctx.label, version: ctx.version, deployment, increment, event, before, after };
  await ctx.save({ status: 'MULTIBAAS_BASICS_PROVEN', ...result, chainStatus: status, uploaded, linked,
    assertions: ['SDK uploaded exact ABI/creation bytecode', 'SDK composed deployment and increment', 'local signatures submitted through SDK',
      'independent Sepolia RPC receipts reconciled', 'runtime and immutable owner checked', 'explicit event indexing starting block', 'SDK and RPC state agree', 'exact counter event'] });
  return result;
}
