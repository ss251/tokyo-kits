// SPDX-License-Identifier: MIT
import { command, kitRoot } from './command'
await command(['bun', 'x', '--no-install', 'tsc', '--noEmit'])
const tests = [...new Bun.Glob('tests/*.test.ts').scanSync({ cwd: kitRoot })].map(path => `./${path}`)
if (!tests.length) throw new Error('Curvegrid integration tests are missing')
await command(['bun', 'test', ...tests])
await command(['forge', 'test', '--threads', '1', '-vv'])
