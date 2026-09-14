// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import { resolve } from 'node:path'
import { command, kitRoot } from './command'
import type { CounterArtifact } from '../multibaas-basics/client'
export async function buildArtifact(): Promise<CounterArtifact> {
  await command(['forge', 'build', '--threads', '1'])
  const compiled = await Bun.file(resolve(kitRoot, 'out/KitCounter.sol/KitCounter.json')).json()
  assert(Array.isArray(compiled.abi) && /^0x[0-9a-f]+$/i.test(compiled.bytecode.object), 'Counter compilation failed')
  assert(/^0x[0-9a-f]+$/i.test(compiled.deployedBytecode.object))
  return { abi: compiled.abi, bytecode: compiled.bytecode.object, deployedBytecode: compiled.deployedBytecode.object, immutableReferences: compiled.deployedBytecode.immutableReferences ?? {} }
}
if (import.meta.main) await buildArtifact()
