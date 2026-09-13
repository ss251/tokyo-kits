import { command, startFork } from './fork'

await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
await command(['bun', 'test', 'tests'])
await command(['forge', 'test', '--threads', '1', '--no-match-path', 'test/integration/**', '-vv'])
const fork = await startFork()
try {
  await command(['forge', 'test', '--threads', '1', '--match-path', 'test/integration/**', '-vv'], { BASE_RPC_URL: fork.rpcUrl })
} finally { fork.stop() }
