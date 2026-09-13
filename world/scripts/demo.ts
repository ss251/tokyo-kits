import { strict as assert } from 'node:assert'
import { createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex, toHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { command } from './command'
import { deploy, startFork, type Fork } from './fork'
import { parseProofBundle } from './proof'

const selected = process.argv[2] ?? 'all'
assert(['all', 'probe', 'minikit-app', 'world-id-verify', 'agentkit', 'continuity-recipe'].includes(selected))
if (selected === 'all' || selected === 'minikit-app') {
  throw new Error('NOT PROVEN: MiniKit needs Developer Portal configuration and a real World App session. Run make dev and follow minikit-app/README.md; make probe verifies fork wiring only.')
}
if (selected === 'agentkit' && !Bun.env.WORLD_AGENT_PRIVATE_KEY) throw new Error('NOT PROVEN: WORLD_AGENT_PRIVATE_KEY must be a World App-registered agent EOA; see agentkit/README.md')
if (['world-id-verify', 'continuity-recipe'].includes(selected) && (!Bun.env.WORLD_PROOF_FILE || !Bun.env.WORLD_RP_ID)) {
  throw new Error('NOT PROVEN: configure the World ID Portal, obtain a fresh human proof, and set WORLD_PROOF_FILE plus WORLD_RP_ID. See world-id-verify/README.md')
}
await command(['forge', 'build', '--threads', '1', '--skip', 'test'])
const fork = await startFork()
try {
  if (selected === 'probe') await probe(fork)
  else if (selected === 'agentkit') await agent(fork)
  else await worldId(fork, selected)
} finally { fork.stop() }

async function worldId(fork: Fork, scenario: string) {
  const file = Bun.file(Bun.env.WORLD_PROOF_FILE!)
  assert(file.size <= 65_536, 'Proof bundle is too large')
  const environment = Bun.env.WORLD_ID_ENVIRONMENT ?? 'staging'
  assert(environment === 'production' || environment === 'staging', 'No official v4 on-chain sandbox deployment is configured')
  const parsed = parseProofBundle(await file.json(), { rpId: Bun.env.WORLD_RP_ID!, action: Bun.env.WORLD_ID_ACTION ?? 'tokyo-kits-verify', environment }, (await fork.client.getBlock()).timestamp)
  const verifier = fork.config.worldIdVerifier[environment] as Address
  const gate = await deploy(fork, 'WorldIDGate', [verifier, parsed.rpId, parsed.action])
  await fork.rpc('anvil_impersonateAccount', [parsed.wallet])
  await fork.rpc('anvil_setBalance', [parsed.wallet, toHex(10n ** 20n)])
  try {
    const wallet = createWalletClient({ account: parsed.wallet, chain: fork.chain, transport: http(fork.rpcUrl) })
    const hash = await wallet.writeContract({ address: gate.address, abi: gate.abi, functionName: 'verifyAndExecute', args: [parsed.nullifier, parsed.nonce, parsed.expiresAtMin, parsed.proof] })
    const proof = await fork.receipt(hash, 'authentic World ID v4 proof accepted by official verifier through caller-bound gate')
    const calls = await fork.client.readContract({ address: gate.address, abi: gate.abi, functionName: 'verifiedCalls', args: [parsed.wallet] })
    assert.equal(calls, 1n)
    await assert.rejects(() => fork.client.simulateContract({ account: parsed.wallet, address: gate.address, abi: gate.abi, functionName: 'verifyAndExecute', args: [parsed.nullifier, parsed.nonce, parsed.expiresAtMin, parsed.proof] }))
    await fork.save(scenario, { status: 'ONCHAIN_WORLD_ID_PROVEN', apiVerificationIncluded: false, fixture: 'Authentic proof supplied privately; caller impersonation and gas funding only on isolated fork', verifier, gate: gate.address, wallet: parsed.wallet, rpId: parsed.rpId, action: parsed.action, proofFileSha256: new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex'), transactions: [gate.proof, proof] })
    console.log(`World ID gated call: ${hash}`)
  } finally { await fork.rpc('anvil_stopImpersonatingAccount', [parsed.wallet]) }
}

async function agent(fork: Fork) {
  const account = privateKeyToAccount(Bun.env.WORLD_AGENT_PRIVATE_KEY as Hex)
  const { runAgentKitHandshake } = await import('../agentkit/demo')
  const handshake = await runAgentKitHandshake({ rpcUrl: fork.rpcUrl, account })
  const gate = await deploy(fork, 'AgentBookGate', [fork.config.agentBook])
  await fork.rpc('anvil_setBalance', [account.address, toHex(10n ** 20n)])
  const wallet = createWalletClient({ account, chain: fork.chain, transport: http(fork.rpcUrl) })
  const note = keccak256(stringToHex('tokyo-kits-agentkit-action'))
  const hash = await wallet.writeContract({ address: gate.address, abi: gate.abi, functionName: 'record', args: [note] })
  const proof = await fork.receipt(hash, 'registered human-bound agent records on-chain action')
  const events = parseEventLogs({ abi: parseAbi(['event AgentAction(address indexed agent,uint256 indexed humanId,bytes32 note)']), eventName: 'AgentAction', logs: proof.receipt.logs.filter(log => log.address.toLowerCase() === gate.address.toLowerCase()) })
  assert.equal(events.length, 1); assert.equal(events[0]!.args.agent.toLowerCase(), account.address.toLowerCase())
  assert.equal(events[0]!.args.humanId, BigInt(handshake.humanId)); assert.equal(events[0]!.args.note, note)
  await fork.save('agentkit', { status: 'REGISTERED_AGENT_PROVEN', handshake, gate: gate.address, agent: account.address, fixture: 'Synthetic gas only; official AgentBook state unchanged', transactions: [gate.proof, proof] })
  console.log(`AgentKit action: ${hash}`)
}

async function probe(fork: Fork) {
  await command(['forge', 'test', '--threads', '1', '--match-path', 'test/WorldIDGateFork.t.sol', '-vv'], { WORLD_RPC_URL: fork.rpcUrl })
  const ping = await deploy(fork, 'WorldPing')
  const note = keccak256(stringToHex('tokyo-kits-fork-wiring-only'))
  const proof = await fork.receipt(await fork.maker.writeContract({ address: ping.address, abi: ping.abi, functionName: 'ping', args: [note] }), 'generic ping on local World Chain fork')
  const gate = await deploy(fork, 'AgentBookGate', [fork.config.agentBook])
  await assert.rejects(() => fork.client.simulateContract({ account: fork.maker.account, address: gate.address, abi: gate.abi, functionName: 'record', args: [note] }))
  await fork.save('infrastructure', { status: 'PARTIAL_ONLY_NOT_SPONSOR_E2E', limitations: ['MiniKit/World App transport not exercised', 'No authentic World ID proof available', 'No human-registered agent available'], assertions: ['both official v4 verifiers reject zero-root proof', 'unregistered agent rejected by official AgentBook-backed gate', 'generic ping contract executes'], transactions: [ping.proof, proof, gate.proof] })
  console.log(`Partial fork wiring receipt: ${proof.receipt.transactionHash}; World components remain NOT PROVEN`)
}
