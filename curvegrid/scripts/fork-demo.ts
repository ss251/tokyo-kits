// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createWalletClient, decodeEventLog, getAddress, http, keccak256, type Address } from 'viem'
import { sepolia } from 'viem/chains'
import { buildArtifact } from './build'
import { endpoint, CHAIN_ID } from './config'
import { createRpc, verifyRuntime } from './rpc'
import { kitRoot } from './command'
import { saveEvidence } from './evidence'

const artifact = await buildArtifact()
const forkUrl = endpoint(Bun.env.CURVEGRID_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com', true).toString()
const upstream = createRpc(forkUrl)
assert.equal(await upstream.getChainId(), CHAIN_ID)
const block = await upstream.getBlock()
const port = await new Promise<number>((yes, no) => {
  const server = createServer(); server.once('error', no)
  server.listen(0, '127.0.0.1', () => { const address = server.address(); assert(address && typeof address === 'object'); const value = address.port; server.close(() => yes(value)) })
})
await mkdir(resolve(kitRoot, '.run'), { recursive: true })
const log = Bun.file(resolve(kitRoot, '.run/anvil.log'))
const fork = Bun.spawn(['anvil', '--host', '127.0.0.1', '--port', String(port), '--threads', '1', '--fork-url', forkUrl, '--fork-header', 'User-Agent: tokyo-kits/0.1', '--fork-block-number', String(block.number), '--chain-id', String(CHAIN_ID), '--silent'], { cwd: kitRoot, stdout: log, stderr: log })
try {
  const url = `http://127.0.0.1:${port}`; const rpc = createRpc(url)
  const deadline = Date.now() + 25_000
  for (;;) {
    try { if (await rpc.getChainId() === CHAIN_ID) break } catch {}
    assert(Date.now() < deadline && fork.exitCode === null, 'Local Sepolia fork did not start; see ignored .run/anvil.log')
    await Bun.sleep(500)
  }
  assert.equal((await rpc.getBlock({ blockNumber: block.number })).hash, block.hash, 'Fork source changed during startup')
  const wallet = createWalletClient({ chain: sepolia, transport: http(url) })
  const accounts = await wallet.getAddresses(); assert(accounts[0] && accounts[1])
  const owner = getAddress(accounts[0]); const stranger = getAddress(accounts[1])
  const deployHash = await wallet.deployContract({ account: owner, abi: artifact.abi, bytecode: artifact.bytecode })
  const deployed = await rpc.waitForTransactionReceipt({ hash: deployHash }); assert.equal(deployed.status, 'success'); assert(deployed.contractAddress)
  const address: Address = getAddress(deployed.contractAddress)
  const runtime = await verifyRuntime(rpc, address, artifact, owner)
  const incrementHash = await wallet.writeContract({ account: owner, address, abi: artifact.abi, functionName: 'increment' })
  const increment = await rpc.waitForTransactionReceipt({ hash: incrementHash }); assert.equal(increment.status, 'success')
  const events = increment.logs.filter(item => getAddress(item.address) === address).map(item => decodeEventLog({ abi: artifact.abi, topics: item.topics, data: item.data }))
  assert.equal(events.length, 1); assert.equal(events[0]!.eventName, 'Incremented')
  assert.deepEqual(events[0]!.args, { caller: owner, value: 1n })
  assert.equal(await rpc.readContract({ address, abi: artifact.abi, functionName: 'value' }), 1n)
  const rejectedHash = await wallet.writeContract({ account: stranger, address, abi: artifact.abi, functionName: 'increment', gas: 100_000n })
  const rejected = await rpc.waitForTransactionReceipt({ hash: rejectedHash }); assert.equal(rejected.status, 'reverted'); assert.equal(rejected.logs.length, 0)
  assert.equal(await rpc.readContract({ address, abi: artifact.abi, functionName: 'value' }), 1n)
  await saveEvidence('infrastructure', 'sepolia-fork-latest.json', { kind: 'local-fork', status: 'PARTIAL_ONLY_NOT_SPONSOR_E2E',
    scope: 'Generic counter deployment, bytecode, event and authority only; no MultiBaas API, indexing or webhook delivery was used',
    forkSource: { chainId: CHAIN_ID, blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp },
    funding: 'Default Anvil local development balances; no public testnet transaction or production funds',
    address, owner, stranger, runtime, artifactCreationHash: keccak256(artifact.bytecode), transactions: { deployed, increment, rejected }, events })
  console.log(`PARTIAL ONLY: local fork counter ${incrementHash}; MultiBaas integration remains NOT PROVEN`)
} finally { fork.kill('SIGTERM'); await fork.exited }
