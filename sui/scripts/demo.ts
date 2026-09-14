import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { requestSuiFromFaucetV2, getFaucetHost } from '@mysten/sui/faucet'
import { Transaction } from '@mysten/sui/transactions'
import { address, assertTestnet, balance, createClient, json, NotProvenError, RECEIPT_INCLUDE, SDK_VERSION, signAndExecute, type RecordedTransaction, type ScenarioContext } from '../lib/client'
import { runPayments } from '../payments/demo'
import { runDefi } from '../defi/demo'
import { buildPackage } from './build'
import { kitRoot } from './command'
import toolchain from '../toolchain.json'

const selected = process.argv[2] ?? 'all'
assert(['all', 'accounts', 'payments', 'defi'].includes(selected), 'Unknown Sui component')
const runDirectory = resolve(kitRoot, '.run')
await mkdir(runDirectory, { recursive: true, mode: 0o700 })
const accountsPath = resolve(runDirectory, 'accounts.json')
if (!await Bun.file(accountsPath).exists()) {
  const accounts = Object.fromEntries(['payer', 'recipient', 'sponsor'].map(role => {
    const key = Ed25519Keypair.generate()
    return [role, { secretKey: key.getSecretKey(), address: key.toSuiAddress() }]
  }))
  await writeFile(accountsPath, JSON.stringify({ network: 'testnet', accounts }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
}
await chmod(accountsPath, 0o600)
const stored = JSON.parse(await readFile(accountsPath, 'utf8')) as { network: string; accounts: Record<string, { secretKey: string; address: string }> }
assert.equal(stored.network, 'testnet')
const accounts = Object.fromEntries(['payer', 'recipient', 'sponsor'].map(role => {
  const saved = stored.accounts[role]; assert(saved)
  const key = Ed25519Keypair.fromSecretKey(saved.secretKey)
  assert.equal(key.toSuiAddress(), saved.address, 'Private account state is inconsistent')
  return [role, key]
})) as Record<'payer' | 'recipient' | 'sponsor', Ed25519Keypair>
assert.equal(new Set(Object.values(accounts).map(key => key.toSuiAddress())).size, 3)
console.log(json({ network: 'testnet', accounts: Object.fromEntries(Object.entries(accounts).map(([role, key]) => [role, key.toSuiAddress()])) }))
if (selected === 'accounts') process.exit(0)

const compiled = await buildPackage()
const client = createClient(Bun.env.SUI_GRPC_URL)
const chainIdentifier = await assertTestnet(client)
const service = (await client.ledgerService.getServiceInfo({})).response
const funding: unknown[] = []
for (const role of ['payer', 'sponsor'] as const) {
  const key = accounts[role]
  if (await balance(client, key.toSuiAddress()) < 500_000_000n) {
    console.log(`Requesting official testnet faucet gas for ${role}`)
    let response
    try { response = await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: key.toSuiAddress() }) }
    catch { throw new NotProvenError(`Official testnet faucet failed or rate-limited for ${role} ${key.toSuiAddress()}; fund this testnet address and retry with the same .run account state`) }
    const deadline = Date.now() + 45_000
    while (await balance(client, key.toSuiAddress()) < 500_000_000n) {
      if (Date.now() > deadline) throw new NotProvenError('Faucet response did not become an adequate spendable gas balance')
      await Bun.sleep(1500)
    }
    funding.push({ role, address: key.toSuiAddress(), response })
  }
}
const compiledSha256 = createHash('sha256').update(json({ modules: compiled.modules, dependencies: compiled.dependencies })).digest('hex')
const deploymentPath = resolve(runDirectory, 'deployment.json')
let deployment: { packageId: string; compiledSha256: string; publisher: string; proof: RecordedTransaction } | undefined

/** A local cache is a locator, never publication evidence. Refresh and bind it to this build. */
async function verifyPublication(packageId: string, digest: string): Promise<RecordedTransaction> {
  const expectedPackage = address(packageId)
  assert(typeof digest === 'string' && digest.length > 0, 'Cached publication digest is missing')
  const result = await client.getTransaction({ digest, include: RECEIPT_INCLUDE })
  assert.equal(result.$kind, 'Transaction', 'Publication did not succeed on the pinned Testnet')
  const transaction = result.Transaction!
  assert.equal(transaction.digest, digest, 'Fetched publication digest mismatch')
  assert(transaction.status.success && transaction.effects.status.success, 'Publication effects do not prove success')
  assert(typeof transaction.transaction.sender === 'string', 'Publication sender is missing')
  assert.equal(address(transaction.transaction.sender), accounts.payer.toSuiAddress(), 'Publication sender mismatch')
  assert.equal(address(transaction.transaction.gasData.owner!), accounts.payer.toSuiAddress(), 'Publication gas owner mismatch')
  assert.equal(transaction.signatures.length, 1, 'Expected the publisher to sign this publication')
  const publishes = transaction.transaction.commands.flatMap(command => 'Publish' in command ? [command.Publish] : [])
  assert.equal(publishes.length, 1, 'Expected exactly one Publish command')
  assert.deepEqual(publishes[0]!.modules, compiled.modules, 'Published modules differ from the current compiled artifact')
  assert.deepEqual(publishes[0]!.dependencies.map(address), compiled.dependencies.map(address), 'Published dependencies differ from the current compiled artifact')
  const packages = transaction.effects.changedObjects.filter(change => change.outputState === 'PackageWrite')
  assert.equal(packages.length, 1, 'Expected exactly one package written by publication')
  assert.equal(address(packages[0]!.objectId), expectedPackage, 'Publication created a different package')
  assert.equal(packages[0]!.idOperation, 'Created', 'Publication did not create this package')
  const { object } = await client.getObject({ objectId: expectedPackage, include: { previousTransaction: true } })
  assert.equal(address(object.objectId), expectedPackage, 'Fetched package ID mismatch')
  assert.equal(object.type, 'package', 'Cached deployment is not a Move package')
  assert.equal(object.owner.$kind, 'Immutable', 'Published package ownership changed')
  assert.equal(object.previousTransaction, digest, 'Package was not created by the verified publication')
  return { label: 'publish generic payments and escrow Move package', digest, transaction }
}

if (await Bun.file(deploymentPath).exists()) {
  const saved = await Bun.file(deploymentPath).json()
  if (saved.compiledSha256 === compiledSha256 && saved.publisher === accounts.payer.toSuiAddress()) {
    const proof = await verifyPublication(saved.packageId, saved.proof?.digest)
    deployment = { packageId: address(saved.packageId), compiledSha256, publisher: accounts.payer.toSuiAddress(), proof }
  }
}
if (!deployment) {
  const tx = new Transaction()
  const capability = tx.publish({ modules: compiled.modules, dependencies: compiled.dependencies })
  tx.transferObjects([capability], accounts.payer.toSuiAddress())
  tx.setGasBudget(200_000_000n)
  const proof = await signAndExecute(client, 'publish generic payments and escrow Move package', tx, accounts.payer)
  const packages = proof.transaction.effects.changedObjects.filter(change => change.outputState === 'PackageWrite')
  assert.equal(packages.length, 1, 'Expected one published package')
  const packageId = address(packages[0]!.objectId)
  const verifiedProof = await verifyPublication(packageId, proof.digest)
  deployment = { packageId, compiledSha256, publisher: accounts.payer.toSuiAddress(), proof: verifiedProof }
  await writeFile(deploymentPath, json(deployment) + '\n', { mode: 0o600 })
}
console.log(`Published package ${deployment.packageId}; digest ${deployment.proof.digest}`)
const sourceFilesSha256: Record<string, string> = {}
const sourcePaths = new Set(['package.json', 'bun.lock', 'toolchain.json', 'addresses.json', 'move/Move.toml', 'move/Move.lock'])
for (const dir of ['scripts', 'lib', 'payments', 'defi', 'move/sources', 'move/tests']) {
  for (const path of new Bun.Glob(`${dir}/**/*`).scanSync({ cwd: kitRoot, onlyFiles: true })) {
    if (/\.(ts|move|py)$/.test(path)) sourcePaths.add(path)
  }
}
for (const path of sourcePaths) sourceFilesSha256[path] = createHash('sha256').update(await readFile(resolve(kitRoot, path))).digest('hex')
assert(sourcePaths.size > 12, 'Incomplete source manifest')
const commit = (await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()).trim()
const dirty = Boolean((await new Response(Bun.spawn(['git', 'status', '--porcelain'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()).trim())
const context: ScenarioContext = {
  client, packageId: deployment.packageId, ...accounts,
  execute: (label, transaction, sender, sponsor) => signAndExecute(client, label, transaction, sender, sponsor),
  async save(scenario, evidence) {
    const path = resolve(kitRoot, scenario, 'receipts', 'testnet-latest.json')
    await mkdir(resolve(kitRoot, scenario, 'receipts'), { recursive: true })
    await writeFile(path, json({ schemaVersion: 1, kind: 'public-testnet', scenario, provenAt: new Date().toISOString(), chainIdentifier,
      sourceCommit: commit, sourceDirty: dirty, sourceFilesSha256, toolchain, sdk: SDK_VERSION, service,
      packageId: deployment!.packageId, compiledSha256, publication: deployment!.proof, funding, ...evidence }) + '\n')
    console.log(`Receipt: ${path}`)
  },
}
let blocked = false
for (const scenario of selected === 'all' ? ['payments', 'defi'] : [selected]) {
  try {
    const result = scenario === 'payments' ? await runPayments(context) : await runDefi(context)
    console.log(json({ scenario, ...result }))
  } catch (error) {
    if (!(error instanceof NotProvenError)) throw error
    blocked = true
    const path = resolve(kitRoot, scenario, 'preflight-latest.json')
    await writeFile(path, json({ checkedAt: new Date().toISOString(), status: 'NOT_PROVEN', reason: error.message, network: 'testnet', payer: accounts.payer.toSuiAddress(), packageId: deployment.packageId }) + '\n')
    console.error(error.message)
  }
}
if (blocked) process.exitCode = 1
