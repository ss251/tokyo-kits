import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { command, kitRoot } from './command'
import toolchain from '../toolchain.json'

export async function buildPackage() {
  const binary = resolve(kitRoot, '.run/tooling/sui')
  assert(await Bun.file(binary).exists(), 'Run make install to fetch the pinned official Sui toolchain')
  const version = (await command([binary, '--version'], {}, true)).trim()
  assert(version.includes(`sui ${toolchain.cliVersion}-${toolchain.sourceCommit.slice(0, 12)}`), 'Unexpected Sui compiler')
  const output = await command([binary, 'move', 'build', '--dump-bytecode-as-base64', '--no-tree-shaking', '--build-env', 'testnet', '--path', 'move'], { RAYON_NUM_THREADS: '1' }, true)
  const jsonStart = output.search(/^\s*\{/m)
  assert(jsonStart >= 0, 'Compiler did not return bytecode JSON')
  if (jsonStart > 0) console.log(output.slice(0, jsonStart).trim())
  const compiled = JSON.parse(output.slice(jsonStart)) as { modules: string[]; dependencies: string[]; digest: number[] }
  assert(Array.isArray(compiled.modules) && compiled.modules.length === 2 && compiled.modules.every(value => typeof value === 'string' && value.length > 0), 'Expected payment and escrow bytecode')
  assert(Array.isArray(compiled.dependencies) && compiled.dependencies.length > 0)
  await mkdir(resolve(kitRoot, '.run'), { recursive: true })
  await Bun.write(resolve(kitRoot, '.run/package.json'), JSON.stringify({ ...compiled, compiler: version, compiledAt: new Date().toISOString() }, null, 2) + '\n')
  console.log(`Compiled ${compiled.modules.length} Move modules with ${version}`)
  return compiled
}
if (import.meta.main) await buildPackage()
