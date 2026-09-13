# Dependency notices

MIT in this directory covers original starter code only. No upstream source
license is changed. Pinned direct versions and transitive integrity hashes are
in package.json/bun.lock; Foundry helper commits are in solidity-dependencies.json.

| Dependency | Upstream license |
| --- | --- |
| World MiniKit, IDKit, AgentKit packages | MIT |
| Next.js, React, viem, Hono | MIT |
| x402 packages | Apache-2.0 |
| OpenZeppelin Contracts | MIT |
| forge-std | Apache-2.0 OR MIT |
| TypeScript | Apache-2.0 |
| Bun/React type declarations | MIT |

The code uses the official World ID verifier and AgentBook on forked World Chain;
those deployments are not copied or relicensed. Sources and exact interfaces
are linked in SOURCES.md. SQLite/runtime licenses remain with the corresponding
Node and Bun distributions. Do not copy dependency code into a submission while
dropping its notices.
