import { command } from './command'
await command(['forge', 'build', '--threads', '1'])
await command(['bun', 'x', '--no-install', 'next', 'build', '--webpack'])
