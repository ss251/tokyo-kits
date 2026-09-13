import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strict as assert } from 'node:assert'
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import addresses from '../addresses.json'
import { kitRoot } from './command'

export const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)
export async function startFork() {
  const config = addresses
  const upstream = Bun.env.WORLD_CHAIN_RPC_URL || config.defaultRpc
  const source = createPublicClient({ transport: http(upstream, { timeout: 30_000, retryCount: 1 }) })
  assert.equal(await source.getChainId(), 480, 'World ID v4 and AgentBook are on World Chain 480')
  const blockNumber = Bun.env.FORK_BLOCK_NUMBER ? BigInt(Bun.env.FORK_BLOCK_NUMBER) : await source.getBlockNumber()
  const block = await source.getBlock({ blockNumber })
  const listener = createServer()
  await new Promise<void>((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  const socket = listener.address(); assert(socket && typeof socket !== 'string')
  const port = socket.port
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  const rpcUrl = `http://127.0.0.1:${port}`
  const child = Bun.spawn(['anvil', '--host', '127.0.0.1', '--port', String(port), '--accounts', '0', '--chain-id', '480', '--fork-url', upstream, '--fork-block-number', String(blockNumber), '--silent'], { stdout: 'ignore', stderr: 'ignore' })
  const chain = defineChain({ id: 480, name: 'World Chain local fork', nativeCurrency: { name: 'Fork gas', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }), pollingInterval: 50 })
  const rpc = async (method: string, params: unknown[] = []) => client.request({ method, params } as never) as Promise<any>
  const stop = () => { child.kill(); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal) }
  const onSignal = () => { stop(); process.exit(130) }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  try {
    let ready = false
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error('Anvil exited before startup; verify World Chain archive RPC access')
      try { ready = await client.getChainId() === 480 } catch { /* startup */ }
      if (ready) break
      await Bun.sleep(250)
    }
    assert(ready, 'World Chain fork did not start')
    const node = await rpc('anvil_nodeInfo')
    assert.equal(node.forkConfig.forkBlockNumber, Number(blockNumber))
    assert.equal((await client.getBlock({ blockNumber })).hash, block.hash, 'Fork provenance mismatch')
    const official = { agentBook: config.agentBook, productionVerifier: config.worldIdVerifier.production, stagingVerifier: config.worldIdVerifier.staging }
    const codeHashes: Record<string, Hex> = {}
    for (const [role, value] of Object.entries(official)) {
      const code = await client.getCode({ address: value as Hex })
      assert(code && code !== '0x', `Official ${role} is absent at the fork block`)
      codeHashes[role] = keccak256(code)
    }
    const account = privateKeyToAccount(generatePrivateKey())
    await rpc('anvil_setBalance', [account.address, toHex(100n * 10n ** 18n)])
    const maker = createWalletClient({ account, chain, transport: http(rpcUrl) })
    const sourceFilesSha256: Record<string, string> = {}
    const paths = new Set(['package.json', 'bun.lock', 'foundry.toml', 'solidity-dependencies.json', 'addresses.json'])
    for await (const file of new Bun.Glob('{src,scripts,app,agentkit,world-id-verify/server}/**/*.{ts,tsx,sol,py}').scan({ cwd: kitRoot })) paths.add(file)
    for (const file of paths) sourceFilesSha256[file] = new Bun.CryptoHasher('sha256').update(await Bun.file(resolve(kitRoot, file)).arrayBuffer()).digest('hex')
    async function receipt(hash: Hex, label: string) {
      const result = await client.waitForTransactionReceipt({ hash })
      assert.equal(result.status, 'success', `${label} reverted`)
      return { label, transaction: await client.getTransaction({ hash }), receipt: result }
    }
    async function save(scenario: string, evidence: Record<string, unknown>) {
      assert(['world-id-verify', 'minikit-app', 'agentkit', 'continuity-recipe', 'infrastructure'].includes(scenario))
      const commit = await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()
      const status = await new Response(Bun.spawn(['git', 'status', '--porcelain'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()
      const record = { schemaVersion: 1, kind: 'local-fork', scenario, provenAt: new Date().toISOString(), sourceChainId: 480, forkChainId: 480, forkBlock: blockNumber, forkBlockHash: block.hash, sourceCommit: commit.trim(), sourceDirty: Boolean(status.trim()), sourceFilesSha256, official, codeHashes, compiler: 'solc 0.8.26; optimizer200; viaIR; cancun', ...evidence }
      await mkdir(resolve(kitRoot, scenario, 'receipts'), { recursive: true })
      const path = resolve(kitRoot, scenario, 'receipts', 'worldchain-latest.json')
      await Bun.write(path, json(record) + '\n'); console.log(`Receipt: ${path}`)
      return record
    }
    return { config, chain, rpcUrl, client, rpc, maker, official, receipt, save, stop }
  } catch (error) { stop(); throw error }
}
export type Fork = Awaited<ReturnType<typeof startFork>>
export async function deploy(fork: Fork, name: string, args: readonly unknown[] = []) {
  const artifact = await Bun.file(resolve(kitRoot, 'out', `${name}.sol`, `${name}.json`)).json()
  const hash = await fork.maker.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args })
  const proof = await fork.receipt(hash, `deploy ${name}`)
  assert(proof.receipt.contractAddress)
  const runtime = await fork.client.getCode({ address: proof.receipt.contractAddress }); assert(runtime && runtime !== '0x')
  return { address: proof.receipt.contractAddress, abi: artifact.abi, proof: { ...proof, compilerMetadata: artifact.metadata, creationCodeHash: keccak256(artifact.bytecode.object as Hex), runtimeCodeHash: keccak256(runtime) } }
}
