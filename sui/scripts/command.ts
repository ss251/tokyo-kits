import { loadavg } from 'node:os'
import { resolve } from 'node:path'

export const kitRoot = resolve(import.meta.dir, '..')
export async function command(args: string[], env: Record<string, string> = {}, capture = false) {
  for (;;) {
    await Bun.spawn(['uptime'], { stdout: 'inherit', stderr: 'inherit' }).exited
    if (loadavg()[0]! <= 25) break
    console.log('Load > 25; waiting 30 seconds before the next compiler/test run.')
    await Bun.sleep(30_000)
  }
  const child = Bun.spawn(args, { cwd: kitRoot, env: { ...Bun.env, ...env }, stdout: capture ? 'pipe' : 'inherit', stderr: 'inherit' })
  const output = capture ? await new Response(child.stdout).text() : ''
  if (await child.exited !== 0) throw new Error(`${args[0]} failed`)
  return output
}
