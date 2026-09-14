// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { kitRoot } from './command'
export const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)
export async function saveEvidence(component: string, name: string, evidence: Record<string, unknown>) {
  const files = new Set(['package.json', 'bun.lock', 'addresses.json', 'foundry.toml'])
  for (const folder of ['scripts', 'src', 'test', 'tests', 'multibaas-basics', 'events-webhooks']) {
    for (const path of new Bun.Glob(`${folder}/**/*`).scanSync({ cwd: kitRoot, onlyFiles: true })) if (/\.(ts|sol|py)$/.test(path)) files.add(path)
  }
  const sourceFilesSha256: Record<string, string> = {}
  for (const path of files) sourceFilesSha256[path] = createHash('sha256').update(await readFile(resolve(kitRoot, path))).digest('hex')
  const sourceCommit = (await new Response(Bun.spawn(['git', 'rev-parse', 'HEAD'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()).trim()
  const sourceDirty = Boolean((await new Response(Bun.spawn(['git', 'status', '--porcelain'], { cwd: kitRoot, stdout: 'pipe' }).stdout).text()).trim())
  const directory = resolve(kitRoot, component, 'receipts')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, name)
  await writeFile(path, json({ schemaVersion: 1, recordedAt: new Date().toISOString(), sourceCommit, sourceDirty, sourceFilesSha256, ...evidence }) + '\n')
  console.log(`Evidence: ${path}`)
}
