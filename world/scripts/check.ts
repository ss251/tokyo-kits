import { command, kitRoot } from './command'
import { startFork } from './fork'

await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
const nodeTests = [...new Bun.Glob('world-id-verify/tests/*.test.ts').scanSync({ cwd: kitRoot })]
await command(['bun', 'build', ...nodeTests, '--target=node', '--packages=external', '--outdir=.run/node-tests'])
const compiledTests = [...new Bun.Glob('.run/node-tests/**/*.js').scanSync({ cwd: kitRoot })]
await command(['node', '--test', ...compiledTests])
await command(['bun', 'test', 'tests'])
await command(['forge', 'test', '--threads', '1', '--no-match-path', 'test/WorldIDGateFork.t.sol', '-vv'])
const fork = await startFork()
try { await command(['forge', 'test', '--threads', '1', '--match-path', 'test/WorldIDGateFork.t.sol', '-vv'], { WORLD_RPC_URL: fork.rpcUrl }) }
finally { fork.stop() }
