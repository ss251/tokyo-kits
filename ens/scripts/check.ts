import { command, kitRoot } from './command'
await command(['python3', 'scripts/fetch-abis.py', '--check'])
await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
const tests = [...new Bun.Glob('tests/*.test.ts').scanSync({ cwd: kitRoot })].map(path => `./${path}`)
if (!tests.length) throw new Error('No ENS tests found')
await command(['bun', 'test', ...tests])
