import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadavg } from 'node:os'
import { strict as assert } from 'node:assert'
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, erc20Abi, http, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import addresses from '../addresses.json'

export const kitRoot = resolve(import.meta.dir, '..')
export const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)
export async function command(args: string[], env: Record<string, string> = {}) {
  do {
    await Bun.spawn(['uptime'], { stdout: 'inherit', stderr: 'inherit' }).exited
    if (loadavg()[0]! <= 25) break
    console.log('Load > 25; waiting 30 seconds before the next compiler/test run.')
    await Bun.sleep(30_000)
  } while (true)
  const process = Bun.spawn(args, { cwd: kitRoot, env: { ...Bun.env, ...env }, stdout: 'inherit', stderr: 'inherit' })
  if (await process.exited !== 0) throw new Error(`${args[0]} failed`)
}

export async function startFork() {
  const name = Bun.env.FORK_CHAIN ?? 'polygon'
  if (name !== 'polygon' && name !== 'base') throw new Error('FORK_CHAIN must be polygon or base')
  const config = addresses.chains[name]
  const upstream = Bun.env[name === 'polygon' ? 'POLYGON_RPC_URL' : 'BASE_RPC_URL'] || config.defaultRpc
  const source = createPublicClient({ transport: http(upstream, { timeout: 30_000, retryCount: 2 }) })
  assert.equal(await source.getChainId(), config.chainId, 'Upstream RPC is the wrong chain')
  const blockNumber = Bun.env.FORK_BLOCK_NUMBER ? BigInt(Bun.env.FORK_BLOCK_NUMBER) : await source.getBlockNumber()
  const block = await source.getBlock({ blockNumber })
  const listener = createServer()
  await new Promise<void>((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve))
  const socket = listener.address()
  assert(socket && typeof socket !== 'string')
  const port = socket.port
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  const rpcUrl = `http://127.0.0.1:${port}`
  // No unlocked default accounts and no mnemonic/private keys in process output.
  const child = Bun.spawn(['anvil', '--host', '127.0.0.1', '--port', String(port), '--accounts', '0', '--chain-id', '31337', '--fork-url', upstream, '--fork-block-number', String(blockNumber), '--silent'], { stdout: 'ignore', stderr: 'ignore' })
  const chain = defineChain({ id: 31337, name: `${name} local fork`, nativeCurrency: { name: 'Fork gas', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }), pollingInterval: 50 })
  const rpc = async (method: string, params: unknown[] = []) => client.request({ method, params } as never) as Promise<any>
  const stop = () => { child.kill(); process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal) }
  const onSignal = () => { stop(); process.exit(130) }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error('Anvil exited before startup; verify RPC archive access')
      try { ready = await client.getChainId() === 31337 } catch { /* startup */ }
      if (ready) break
      await Bun.sleep(250)
    }
    assert(ready, 'Anvil did not start')
    const node = await rpc('anvil_nodeInfo')
    assert.equal(node.forkConfig.forkBlockNumber, Number(blockNumber), 'Anvil fork block differs from requested provenance')
    const localBlock = await client.getBlock({ blockNumber })
    assert.equal(localBlock.hash, block.hash, 'Running fork does not match the captured upstream block hash')
    const official = { aqua: config.aqua as Address, router: config.router as Address }
    const codeHashes: Record<string, Hex> = {}
    for (const [role, address] of Object.entries(official)) {
      const code = await client.getCode({ address })
      assert(code && code !== '0x', `Missing official ${role} code`)
      codeHashes[role] = keccak256(code)
    }
    const registry = await client.readContract({ address: official.router, abi: parseAbi(['function AQUA() view returns (address)']), functionName: 'AQUA' })
    assert.equal(registry.toLowerCase(), official.aqua, 'Router points to a different Aqua registry')
    async function wallet() {
      const account = privateKeyToAccount(generatePrivateKey())
      await rpc('anvil_setBalance', [account.address, toHex(100n * 10n ** 18n)])
      return createWalletClient({ account, chain, transport: http(rpcUrl) })
    }
    const maker = await wallet(), taker = await wallet()
    const sourceFiles: Record<string, string> = {}
    const sourcePaths = new Set(['package.json', 'bun.lock', 'foundry.toml', 'solidity-dependencies.json', 'addresses.json'])
    for await (const file of new Bun.Glob('{src,scripts,api-swap,lp-api}/**/*.{ts,sol,py}').scan({ cwd: kitRoot })) sourcePaths.add(file)
    for (const file of sourcePaths) sourceFiles[file] = new Bun.CryptoHasher('sha256').update(await Bun.file(resolve(kitRoot, file)).arrayBuffer()).digest('hex')
    const funding: unknown[] = []
    const setupTransactions: unknown[] = []
    async function balance(token: Address, holder: Address) {
      return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] })
    }
    async function fund(token: Address, holder: Address, amount: bigint) {
      if (await balance(token, holder) === amount) {
        funding.push({ token, holder, amount, method: 'balance-already-sufficient; no mutation' })
        return
      }
      // Foundry deal-style fixture: locate the ERC20 balance mapping on this isolated fork.
      // Restore every failed probe. Never writes the registry/router or public upstream.
      for (let slot = 0n; slot < 100n; slot++) {
        const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, slot]))
        const original = await client.getStorageAt({ address: token, slot: key }) ?? toHex(0n, { size: 32 })
        await rpc('anvil_setStorageAt', [token, key, toHex(amount, { size: 32 })])
        let matched = false
        try {
          matched = await balance(token, holder) === amount
          if (matched) { funding.push({ token, holder, amount, method: 'anvil_setStorageAt', mappingSlot: slot }); return }
        } finally {
          if (!matched) await rpc('anvil_setStorageAt', [token, key, original])
        }
      }
      throw new Error(`Could not locate balance mapping for ${token}; no fixture funding applied`)
    }
    async function receipt(hash: Hex, label: string) {
      const result = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
      assert.equal(result.status, 'success', `${label} reverted`)
      return { label, transaction: await client.getTransaction({ hash }), receipt: result }
    }
    async function save(scenario: string, evidence: Record<string, unknown>) {
      const commit = await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()
      const status = await new Response(Bun.spawn(['git', 'status', '--porcelain'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()
      const dependencies = await Bun.file(resolve(kitRoot, 'solidity-dependencies.json')).json()
      const record = { schemaVersion: 1, kind: 'local-fork', scenario, provenAt: new Date().toISOString(), sourceCommit: commit.trim(), sourceDirty: status.trim().length > 0, compiler: 'solc 0.8.30; optimizer 200; viaIR; cancun', solidityDependencies: dependencies, sourceFilesSha256: sourceFiles, sourceChain: name, sourceChainId: config.chainId, forkChainId: 31337, forkBlock: blockNumber, forkBlockHash: localBlock.hash, official, codeHashes, fixtureFunding: funding, setupTransactions, ...evidence }
      await mkdir(resolve(kitRoot, scenario, 'receipts'), { recursive: true })
      const path = resolve(kitRoot, scenario, 'receipts', `${name}-latest.json`)
      await Bun.write(path, json(record) + '\n')
      console.log(`Receipt: ${path}`)
      return record
    }
    return { name, config, rpcUrl, client, rpc, maker, taker, official, balance, fund, receipt, save, setupTransactions, stop }
  } catch (error) { stop(); throw error }
}

export type Fork = Awaited<ReturnType<typeof startFork>>
export type ForkWallet = Fork['maker']
export async function deploy(fork: Fork, contract: string, args: readonly unknown[] = []) {
  const artifact = await Bun.file(resolve(kitRoot, 'out', `${contract}.sol`, `${contract}.json`)).json()
  const hash = await fork.maker.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args })
  const transactionProof = await fork.receipt(hash, `deploy ${contract}`)
  assert(transactionProof.receipt.contractAddress)
  const runtime = await fork.client.getCode({ address: transactionProof.receipt.contractAddress })
  assert(runtime && runtime !== '0x')
  const proof = { ...transactionProof, artifact: { compilerMetadata: artifact.metadata ?? artifact.rawMetadata, creationCodeHash: keccak256(artifact.bytecode.object as Hex), deployedRuntimeHash: keccak256(runtime) } }
  return { address: transactionProof.receipt.contractAddress, abi: artifact.abi, proof }
}
