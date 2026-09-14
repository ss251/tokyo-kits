import { resolve } from 'node:path'
import { command, kitRoot } from './command'
await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
const tests = [...new Bun.Glob('tests/*.test.ts').scanSync({ cwd: kitRoot })].map(path => `./${path}`)
if (!tests.length) throw new Error('Sui SDK tests are missing')
await command(['bun', 'test', ...tests])
await command([resolve(kitRoot, '.run/tooling/sui'), 'move', 'test', '--path', 'move', '--build-env', 'testnet', '--threads', '1'], { RAYON_NUM_THREADS: '1' })
