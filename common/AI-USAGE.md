# AI-assisted build record

This is a concise record of the user-provided specification and material implementation decisions for Tokyo Kits. It is not a full conversation transcript and does not claim to contain hidden system instructions, private model reasoning, or every intermediate prompt. The canonical specification is [KITS-BRIEF.md](../KITS-BRIEF.md); the granular Git history, kit source notes, and actual receipts provide implementation evidence.

## User brief and addenda

The user requested one working, tested, MIT-licensed generic integration starter per ETHGlobal Tokyo sponsor, plus shared plumbing, using the existing `/Users/thescoho/Developer/tokyo-kits` repository. The requested order was Aqua, Uniswap, World, ENS, Sui, Curvegrid, then common. Research context was supplied through the separate Tokyo warroom; its research files were not part of the implementation directories.

The brief required official contracts and pinned current SDKs, no secrets in git, frequent small commits, uptime checks before builds, one expensive build/test at a time under `nice`, and no access to the unrelated `~/Developer/slip` project. Original starter code was to remain generic prior art, publicly disclosed before the event.

The sub-track addendum expanded coverage into component folders: Aqua open app/opcode/Continuity; Uniswap v4/API swap/LP API/v3/CCA/Continuity; World MiniKit/World ID/AgentKit/Continuity; ENS new-app/existing-app; Sui payments/DeFi; and Curvegrid basics/events-webhooks. These folders do not imply separate confirmed prize pools. The deadline addendum moved the target to **Sep 18 JST** and explicitly allowed documented **NOT PROVEN** stubs when a component could not produce real evidence in time.

The disclosure addendum required written disclosure of reused work, preservation of granular history, and inclusion of relevant specifications, prompts, and planning artifacts with the event submission. Publication and successful execution are recorded separately.

## How AI was used

Codex/Astra assisted with official-source research, SDK and ABI inspection, Solidity and Move implementation, TypeScript clients, unit tests, fork/testnet scripts, independent code review, and documentation. Parallel agents worked on bounded file sets, while the main build task serialized installations, compilers, tests, and demonstrations. Review findings led to changes before proof capture, including stronger calldata validation, exact event/receipt checks, caller-bound identity, replay protection, and explicit proof-status distinctions.

Humans or real external prerequisites remain necessary where an integration requires an account, entitlement, authenticated device session, identity proof, registration, funding, or reachable callback. Missing prerequisites were documented rather than replaced with invented service responses or claimed receipts. Local fixtures are explicitly identified.

## Material decisions to preserve with reuse

| Area | Build decision and disclosure consequence |
| --- | --- |
| Aqua | Use the official registry and official compatible SDK/router sources. Preserve upstream opcode semantics when adding a custom opcode. Separate custom-app, custom-router, and official-router Extruction evidence. |
| Uniswap | Mine the v4 hook's actual CREATE2 address and use official PoolManager, PositionManager, router, quoter, and other stack deployments. Treat unsigned API responses as preparation only. Bound decoded LP mutations and distinguish a fork-created NFT from a public NFT used by the public API. |
| World | Use current World ID v4 interfaces on World Chain 480, caller-bound signal hashing, fixed scope, persistent replay protection, and authentic human prerequisites. Mock verifier or AgentBook acceptance and official rejection checks do not prove a human flow. |
| ENSv2 | Pin the current official deployment/artifacts; prove registration, linked subnames, scoped record permissions, and records changing application behavior through the universal resolver. |
| Sui | Use the official current SDK over gRPC, pin both CLI and resolved framework revisions, transfer actual Circle Testnet USDC for payments, and use native Testnet SUI for escrow. Sign sender/sponsor transactions with distinct generated test accounts. Keep unit mint/Clock fixtures separate from public execution. |
| Curvegrid | Require an actual MultiBaas deployment, separate setup/runtime API keys, validate the locally authorized transaction before signing, enable indexing with an explicit start block, and authenticate/deduplicate external callbacks. A counter-only fork remains partial evidence. |
| Common | Run kit checks in the required order without parallel compiler jobs; distinguish schema checks, generic fork canaries, sponsor fork proofs, and public-testnet receipts. |

No product-specific submission was built by these templates. An event team must identify the exact public commit reused, describe what it added during the event, retain the relevant brief and build artifacts, and disclose the starter and AI assistance in its own submission. Do not present this summary as the team's complete event prompt history; include that team's actual specifications, prompts, and planning records as well.
