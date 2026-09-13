import { strict as assert } from 'node:assert'
import { command, startFork } from './fork'
import { runV4 } from './v4'
import { runV3 } from './v3'
import { requireApiKey } from '../api-swap/client'

const selected = process.argv[2] ?? 'all'
assert(['all', 'onchain', 'v4-hook', 'v3-or-v2', 'cca', 'continuity-recipe', 'api-swap', 'lp-api'].includes(selected), 'Unknown demo component')
if (selected === 'api-swap' || selected === 'lp-api') requireApiKey(selected === 'api-swap' ? 'swap' : 'lp')
await command(['forge', 'build', '--threads', '1', '--skip', 'test'])
const fork = await startFork()
try {
  if (['all', 'onchain', 'v4-hook'].includes(selected)) await runV4(fork)
  if (['all', 'onchain', 'v3-or-v2'].includes(selected)) await runV3(fork)
  if (['all', 'onchain', 'cca'].includes(selected)) {
    const { runCca } = await import('./cca')
    await runCca(fork)
  }
  if (['all', 'onchain', 'continuity-recipe'].includes(selected)) await runV3(fork, 'continuity-recipe')
  if (['all', 'api-swap', 'lp-api'].includes(selected)) {
    const { runApiExecution } = await import('./api-execution')
    await runApiExecution(fork, selected === 'lp-api' ? 'lp-api' : 'api-swap')
    if (selected === 'all') await runApiExecution(fork, 'lp-api')
  }
} finally { fork.stop() }
