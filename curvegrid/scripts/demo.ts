// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Configuration, WebhooksApi } from '@curvegrid/multibaas-sdk'
import { encodeFunctionData, getAddress, keccak256, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createMultiBaasAdapter, MultiBaasRequestError } from '../multibaas-basics/client'
import { COUNTER_ABI, counterLog, runBasics, type ExecuteRequest } from '../multibaas-basics/demo'
import { validateUnsignedTransaction, type RpcLog } from '../multibaas-basics/validation'
import { pollCounterEvent, validateIndexedCounterEvent } from '../events-webhooks/poll'
import { WebhookStore } from '../events-webhooks/store'
import { startWebhookServer } from '../events-webhooks/server'
import { EVENT_SIGNATURE, validateWebhookConfig, type WebhookScope } from '../events-webhooks/verify'
import { buildArtifact } from './build'
import { loadConfig, NotProvenError, CHAIN_ID } from './config'
import { kitRoot } from './command'
import { json, saveEvidence } from './evidence'
import { createRpc, verifyRuntime, waitForSdkReceipt } from './rpc'

const aliases: Record<string, string> = { basics: 'multibaas-basics', events: 'events-webhooks' }
const selected = aliases[process.argv[2] ?? ''] ?? process.argv[2] ?? 'all'
assert(['all', 'multibaas-basics', 'events-webhooks'].includes(selected), 'Unknown Curvegrid component')
let basicsCompleted = false
async function blocked(component: string, error: NotProvenError) {
  await writeFile(resolve(kitRoot, component, 'preflight-latest.json'), json({ checkedAt: new Date().toISOString(), status: 'NOT_PROVEN', reason: error.message, chainId: CHAIN_ID }) + '\n')
  console.error(error.message); process.exitCode = 1
}
async function main() {
  const config = loadConfig(selected === 'events-webhooks' ? 'events-webhooks' : 'multibaas-basics')
  const rpc = createRpc(config.rpcUrl)
  assert.equal(await rpc.getChainId(), CHAIN_ID, 'Independent RPC must be Sepolia')
  const mb = createMultiBaasAdapter(config); const chainStatus = await mb.chainStatus()
  assert.equal(chainStatus.chainId, CHAIN_ID)
  const run = resolve(kitRoot, '.run'); await mkdir(run, { recursive: true, mode: 0o700 })
  const signerPath = resolve(run, 'signer.json')
  let key = Bun.env.CURVEGRID_PRIVATE_KEY
  if (!key) {
    if (!await Bun.file(signerPath).exists()) {
      const generated = generatePrivateKey(); const account = privateKeyToAccount(generated)
      await writeFile(signerPath, json({ chainId: CHAIN_ID, privateKey: generated, address: account.address }) + '\n', { mode: 0o600, flag: 'wx' })
    }
    await chmod(signerPath, 0o600)
    const saved = await Bun.file(signerPath).json(); assert.equal(saved.chainId, CHAIN_ID)
    assert(typeof saved.privateKey === 'string' && /^0x[0-9a-fA-F]{64}$/.test(saved.privateKey), 'Invalid private testnet account state')
    key = saved.privateKey; assert.equal(privateKeyToAccount(key as Hex).address, saved.address)
  }
  assert(key && /^0x[0-9a-fA-F]{64}$/.test(key), 'CURVEGRID_PRIVATE_KEY must be a private testnet signer')
  const account = privateKeyToAccount(key as Hex)
  console.log(`Sepolia test signer: ${account.address}`)
  if (await rpc.getBalance({ address: account.address }) < 20_000_000_000_000_000n) throw new NotProvenError(`Fund Sepolia test address ${account.address} with at least 0.02 test ETH, then retry with the same ignored .run/signer.json. Production assets are not used.`)
  const artifact = await buildArtifact()
  const label = `tokyokits-${keccak256(artifact.bytecode).slice(2, 14)}`; const version = '0.1.0'
  const execution: unknown[] = []; const runtimes: unknown[] = []
  const nextNonce = () => rpc.getTransactionCount({ address: account.address, blockTag: 'pending' })
  async function execute(request: ExecuteRequest) {
    assert.equal(await rpc.getChainId(), CHAIN_ID)
    assert.equal((await mb.chainStatus()).chainId, CHAIN_ID)
    assert.equal(request.intent.from, account.address)
    assert.equal(request.intent.nonce, await nextNonce(), 'Unsigned transaction nonce became stale')
    const transaction = validateUnsignedTransaction(request.unsigned, request.intent)
    const signed = await account.signTransaction(transaction)
    const expectedHash = keccak256(signed)
    assert.equal(await mb.submitSigned(signed), expectedHash)
    const receipt = await rpc.waitForTransactionReceipt({ hash: expectedHash, timeout: 90_000, confirmations: 1 })
    assert.equal(receipt.status, 'success', 'Independent RPC transaction failed')
    const actual = await rpc.getTransaction({ hash: expectedHash })
    assert.equal(actual.chainId, CHAIN_ID); assert.equal(getAddress(actual.from), account.address)
    assert.equal(actual.to ? getAddress(actual.to) : null, request.intent.to)
    assert.equal(actual.input.toLowerCase(), request.intent.data.toLowerCase())
    assert.equal(actual.value, 0n); assert.equal(actual.nonce, request.intent.nonce)
    assert.equal(actual.gas, transaction.gas)
    const sdkReceipt = await waitForSdkReceipt(mb, expectedHash)
    assert.equal(sdkReceipt.blockHash, receipt.blockHash); assert.equal(sdkReceipt.blockNumber, receipt.blockNumber)
    const contractAddress = receipt.contractAddress ? getAddress(receipt.contractAddress) : null
    assert.equal(sdkReceipt.contractAddress, contractAddress)
    const logs: RpcLog[] = receipt.logs.map(log => ({ address: getAddress(log.address), topics: log.topics, data: log.data, logIndex: log.logIndex,
      transactionHash: log.transactionHash, blockHash: log.blockHash, blockNumber: log.blockNumber, removed: log.removed }))
    assert.deepEqual(sdkReceipt.logs, logs, 'SDK receipt logs differ from independent RPC')
    assert.equal((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash, 'Receipt block reorganized')
    execution.push({ label: request.label, hash: expectedHash, transaction: actual, receipt, sdkReceipt })
    console.log(`${request.label}: ${expectedHash}`)
    return { hash: expectedHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, contractAddress, logs }
  }
  const basic = await runBasics({ mb, artifact, label, version, signer: account.address, nextNonce, execute,
    readValue: address => rpc.readContract({ address, abi: COUNTER_ABI, functionName: 'value' }),
    readOwner: async address => getAddress(await rpc.readContract({ address, abi: COUNTER_ABI, functionName: 'owner' })),
    verifyRuntime: async (address, compiled) => { runtimes.push(await verifyRuntime(rpc, address, compiled, account.address)) },
    save: evidence => saveEvidence('multibaas-basics', 'sepolia-latest.json', { kind: 'public-testnet', chainId: CHAIN_ID, sdkVersion: '1.1.1', execution, runtimes, ...evidence }),
  })
  basicsCompleted = true
  if (selected === 'multibaas-basics') return
  const callbacks = loadConfig('events-webhooks')
  const webhooks = new WebhooksApi(new Configuration({ basePath: `${config.baseUrl}/api/v0`, accessToken: config.adminApiKey,
    baseOptions: { timeout: 15_000, maxRedirects: 0, maxContentLength: 2_000_000, maxBodyLength: 2_000_000 } }))
  async function service<T extends { status: number }>(operation: string, call: PromiseLike<{ data: T }>): Promise<T> {
    try { const response = await call; assert(response.data.status >= 200 && response.data.status < 300); return response.data }
    catch { throw new MultiBaasRequestError(operation) }
  }
  const created = (await service('create webhook', webhooks.createWebhook({ url: callbacks.webhookUrl!, label: `tokyokits-${Date.now()}`, subscriptions: ['event.emitted'] }))).result
  assert(Number.isSafeInteger(created.id) && created.id > 0, 'Create webhook did not return a valid resource ID')
  let store: WebhookStore | undefined
  let server: ReturnType<typeof startWebhookServer> | undefined
  let primaryFailed = false
  try {
    const webhookConfig = validateWebhookConfig({ chainId: CHAIN_ID, contractAddress: basic.address, eventSignature: EVENT_SIGNATURE,
      deploymentId: new URL(config.baseUrl).hostname, webhookId: created.id, secret: created.secret })
    assert.equal(created.url, callbacks.webhookUrl); assert.deepEqual(created.subscriptions, ['event.emitted'])
    await writeFile(resolve(run, 'webhook-config.json'), json(webhookConfig) + '\n', { mode: 0o600 })
    await chmod(resolve(run, 'webhook-config.json'), 0o600)
    const scope: WebhookScope = { chainId: CHAIN_ID, contractAddress: basic.address, eventSignature: EVENT_SIGNATURE, deploymentId: webhookConfig.deploymentId, webhookId: created.id }
    store = new WebhookStore(resolve(run, 'webhooks.sqlite'))
    server = startWebhookServer({ config: webhookConfig, store })
    const nonce = await nextNonce()
    const unsigned = await mb.composeIncrement(basic.address, label, account.address, nonce)
    const proof = await execute({ label: 'MultiBaas write for indexing and actual webhook delivery', unsigned,
      intent: { kind: 'call', chainId: CHAIN_ID, from: account.address, to: basic.address, nonce, data: encodeFunctionData({ abi: COUNTER_ABI, functionName: 'increment' }), maxGas: 200_000n } })
    const log = counterLog(proof, basic.address, account.address, 2n)
    const expected = { address: basic.address, label, hash: proof.hash, blockHash: proof.blockHash, blockNumber: proof.blockNumber, caller: account.address, value: 2n, log }
    const indexed = await pollCounterEvent(mb, expected)
    const deadline = Date.now() + 120_000
    let delivered = store.findEvent({ ...scope, transactionHash: proof.hash, logIndex: log.logIndex! })
    while (!delivered && Date.now() < deadline) { await Bun.sleep(1000); delivered = store.findEvent({ ...scope, transactionHash: proof.hash, logIndex: log.logIndex! }) }
    if (!delivered) throw new NotProvenError('No authenticated external MultiBaas webhook arrived within 120 seconds; verify the HTTPS /webhook tunnel to local port 8787')
    validateIndexedCounterEvent(delivered.event.data, expected)
    assert.equal((await rpc.getBlock({ blockNumber: proof.blockNumber })).hash, proof.blockHash, 'Webhook refers to a reorganized block')
    assert.equal(await rpc.readContract({ address: basic.address, abi: COUNTER_ABI, functionName: 'value' }), 2n)
    await saveEvidence('events-webhooks', 'sepolia-latest.json', { kind: 'public-testnet', status: 'MULTIBAAS_INDEXING_AND_WEBHOOK_PROVEN', chainId: CHAIN_ID,
      scope, indexed, delivered, execution, runtimes, assertions: ['SDK indexed exact RPC event', 'actual external webhook authenticated over raw bytes and timestamp', 'persistent scoped replay handling', 'delivered event reconciled with canonical Sepolia receipt'] })
  } catch (error) { primaryFailed = true; throw error }
  finally {
    let cleanupFailed = false
    try { await server?.stop(true) } catch { cleanupFailed = true }
    try { store?.close() } catch { cleanupFailed = true }
    try { await service('delete demo webhook', webhooks.deleteWebhook(created.id)) } catch { cleanupFailed = true }
    if (cleanupFailed) {
      console.error(`Demo cleanup failed; inspect webhook ${created.id} in the configured MultiBaas deployment`)
      if (!primaryFailed) throw new MultiBaasRequestError('demo cleanup')
    }
  }
}
try { await main() }
catch (error) {
  if (error instanceof NotProvenError) {
    for (const component of selected === 'all' ? ['multibaas-basics', 'events-webhooks'] : [selected]) {
      if (component === 'multibaas-basics' && basicsCompleted) continue
      await blocked(component, error)
    }
  } else {
    // Never print arbitrary SDK/RPC exception objects: request configuration can contain keys.
    console.error(error instanceof MultiBaasRequestError ? error.message : 'Curvegrid demo failed a verification check; no successful proof was written for the failed stage')
    process.exitCode = 1
  }
}
