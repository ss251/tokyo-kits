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
    const seconds = Number(Bun.env.FORK_KEEP_SECONDS ?? '300')
    assert(Number.isInteger(seconds) && seconds > 0 && seconds <= 3600, 'FORK_KEEP_SECONDS must be 1..3600')
    console.log(`Fork retained for ${seconds}s at ${fork.rpcUrl}. Stop with Ctrl-C; local names disappear on shutdown.`)
    await Bun.sleep(seconds * 1000)
  }
} finally { fork.stop() }
