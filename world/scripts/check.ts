import { command, kitRoot } from './command'
import { startFork } from './fork'

await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
const nodeTests = ['world-id-verify/tests', 'app/_server'].flatMap(dir => [...new Bun.Glob(`${dir}/*.test.ts`).scanSync({ cwd: kitRoot })])
if (nodeTests.length < 3) throw new Error('Node test discovery is incomplete')
await command(['bun', 'build', ...nodeTests, '--target=node', '--packages=external', '--outdir=.run/node-tests'])
const compiledTests = nodeTests.map(path => `.run/node-tests/${path.replace(/\.ts$/, '.js')}`)
await command(['node', '--test', '--test-concurrency=1', ...compiledTests])
const bunTests = [...new Bun.Glob('tests/*.test.ts').scanSync({ cwd: kitRoot })].map(path => `./${path}`)
await command(['bun', 'test', ...bunTests])
await command(['forge', 'test', '--threads', '1', '--no-match-path', 'test/WorldIDGateFork.t.sol', '-vv'])
const fork = await startFork()
try { await command(['forge', 'test', '--threads', '1', '--match-path', 'test/WorldIDGateFork.t.sol', '-vv'], { WORLD_RPC_URL: fork.rpcUrl }) }
finally { fork.stop() }
