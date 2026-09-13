import { strict as assert } from 'node:assert'
import { startFork } from './fork'
import { runScenario } from './scenarios'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { kitRoot } from './command'
const selected = process.argv[2] ?? 'all'
assert(['all', 'new-app-ensv2', 'add-to-existing'].includes(selected), 'Unknown ENS component')
const fork = await startFork()
try {
  for (const scenario of selected === 'all' ? ['new-app-ensv2', 'add-to-existing'] : [selected]) {
    await runScenario(fork, scenario as 'new-app-ensv2' | 'add-to-existing')
  }
  if (Bun.env.KEEP_FORK_ALIVE === 'true') {
    await mkdir(resolve(kitRoot, '.run'), { recursive: true })
    await Bun.write(resolve(kitRoot, '.run/ui-fork.json'), JSON.stringify({ rpcUrl: fork.rpcUrl }) + '\n')
    console.log(`Fork retained for UI checks at ${fork.rpcUrl}. Stop with Ctrl-C; local names disappear on shutdown.`)
    await new Promise<void>(() => {})
  }
} finally { fork.stop() }
