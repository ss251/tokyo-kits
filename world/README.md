# World integration starters

**NOT PROVEN end to end.** The four components are implemented for current
World SDKs, but this environment has no Portal RP signing key, live World App
session, authentic World ID proof, or registered agent signing key. Those
requirements cannot be replaced by test fixtures. Tokyo's exact World prize
categories remain unpublished; these are component examples, not confirmed
separate award pools.

| Component | Which idea would use it? | Current evidence |
| --- | --- | --- |
| [MiniKit app](minikit-app/) | Wallet authentication and a zero-value transaction inside World App | Next.js UI and routes; World App execution NOT PROVEN |
| [World ID verification](world-id-verify/) | One human, one action, bound to a wallet | Signed RP requests, persistent replay protection, official-v4 gate; authentic proof NOT PROVEN |
| [AgentKit](agentkit/) | Give registered human-backed agents a shared endpoint allowance and an on-chain action | Real SDK signatures and persistent quota tests; registered-agent execution NOT PROVEN |
| [Continuity recipe](continuity-recipe/) | Add identity-based access to an existing app | Shared verification and receipt adapters; live integration NOT PROVEN |

## Five-minute setup

Requires Bun 1.3.14, **Node 24.15.0** (or compatible Node with `node:sqlite`),
Foundry 1.5.1, Python 3.12 and Git. Copy `.env.example` to an ignored `.env` if
one does not exist; follow each component's Portal/key setup instructions.

```sh
cd world
make install
make test
make build
make dev
# Open http://localhost:3000
make probe
```

All builds/tests check uptime, wait above load25, share the Tokyo Kits lock and
run at nice19. Next.js uses one build worker. The World ID server runs under
Node's SQLite engine; its tests are bundled and executed by Node. AgentKit is
a separate Bun service with Bun SQLite. Use `make test`, which selects the two
runtimes correctly, rather than recursively running all files with Bun.

`make demo` fails explicitly while MiniKit's human/Portal steps are missing.
Each subfolder has its own demo target. `make probe` is an independent partial
fork check and never marks a sponsor component proven.

## Architecture

```text
MiniKit walletAuth → server nonce + World Chain signature check → wallet session
IDKit 4 → signed RP challenge + wallet signature → official /api/v4/verify
                                                   ↓ atomic SQLite nullifier
                                             verified, scoped session
                                                   ↓ MiniKit sendTransaction
                                             public Ping receipt + event

private authentic v4 proof → official WorldIDVerifier on World Chain fork
                              → caller-bound WorldIDGate + replay rejection

AgentKit SDK challenge/signature → official AgentBook lookup → atomic human quota
                              → signed AgentBookGate action on World Chain fork
```

The MiniKit ping is intentionally generic and transfers no assets. World ID
verification is enforced by the server before preparing it; the ping contract
itself makes no identity claim. `WorldIDGate` separately demonstrates on-chain
proof enforcement with the official verifier. AgentBook's registry is never
rewritten to manufacture a positive human-registration result.

## Last proven

Validation: **59 tests pass** (24 Node, 17 Bun, 16 Solidity unit and 2 official-fork rejection checks); strict TypeScript and production Next.js build pass.

Only infrastructure has a fork receipt: [World Chain wiring evidence](infrastructure/receipts/worldchain-latest.json),
recorded 2026-09-14 JST. Generic ping hash:
`0x6b33e9453927bd904014beddee7b89b5a41adee885281ec4f7dbf85b18a7cc36`.
Both official v4 proxies reject unknown Merkle roots, and an unregistered agent
cannot call the AgentBook-backed gate. Its status is
`PARTIAL_ONLY_NOT_SPONSOR_E2E`. Unit tests use explicitly named verifier/Book
fixtures for acceptance paths; they do not demonstrate human verification.

## Remaining human steps, checked 2026-09-17

Everything below was attempted or inspected on 2026-09-17 JST from this build
environment. None of it can be completed by an unattended runner; each step
needs a person with a verified World App account.

1. **Developer Portal sign-in needs World App.** `developer.world.org` → *Sign in*
   redirects to `id.worldcoin.org`, whose only option is "Scan with World App to
   sign in to World Developer Portal". There is no email, password or OAuth
   route, so no Mini App ID, World ID app ID, RP ID or RP signing key could be
   created here. After signing in on a phone, fill `WORLD_MINIKIT_APP_ID`,
   `WORLD_ID_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` and
   `WORLD_ID_ACTION` in the ignored `.env`.
2. **`WorldPing` must exist on public World Chain 480.** No wallet available
   here holds any ETH on World Chain, and the free faucets used for Sepolia do
   not serve chain 480. Deploy `src/WorldPing.sol` from a funded wallet
   (`forge create --rpc-url $WORLD_CHAIN_RPC_URL --private-key … src/WorldPing.sol:WorldPing`),
   allowlist the address in the Mini App's Portal settings, then set
   `WORLD_PING_ADDRESS` and `WORLD_PING_ALLOWLIST_CONFIRMED=true`.
3. **MiniKit app:** expose `make dev` through an HTTPS tunnel, set that origin
   as the Mini App URL and `WORLD_APP_ORIGIN`, open the Mini App inside World
   App and approve *Authenticate*, *Verify with World ID* and *Send zero-value
   ping*. The UI shows the Worldscan link only after the server has matched the
   receipt; then run `make -C minikit-app demo`.
4. **World ID verification and Continuity recipe:** from that same UI, export
   the fresh authentic proof to `.run/world-id-private-proof.json`
   (`WORLD_PROOF_FILE`), then run `make -C world-id-verify demo` and
   `make -C continuity-recipe demo` within the proof's validity window.
5. **AgentKit:** generate an agent key, run
   `bunx @worldcoin/agentkit-cli@0.2.0 register 0xAgent`, confirm the
   registration in World App, verify with `… status 0xAgent`, put the key in
   `WORLD_AGENT_PRIVATE_KEY`, and run `make -C agentkit demo`.

With a verified account already on the phone, steps 1–5 take roughly thirty
minutes; the demos then write the receipts described above and the four
component READMEs can drop their NOT PROVEN labels. Until then every World
component stays **NOT PROVEN**, and the infrastructure receipt above remains
partial evidence only.

The proof runner writes full local transactions/receipts, official code hashes,
source manifests and upstream block/hash provenance. Local-fork hashes do not
appear in public explorers. Proof downloads belong in ignored `.run/`; keys
never belong in git. A successful future WorldIDGate demo labels on-chain proof
acceptance separately from server API verification.

## Version and deployment traps

- MiniKit **2.0.3** uses `walletAuth`, `signMessage`, and `sendTransaction`.
  Verification belongs to IDKit **4.2.3**, core **4.2.4**, server **1.1.1**;
  `MiniKit.commandsAsync.verify` is obsolete.
- V4 production and staging verifier proxies both live on **World Chain480**.
  The documented4801 router is legacy v3 with eight proof words. This kit uses
  the official v4 deployment on a mainnet fork; it does not downgrade to claim
  a v4 testnet deployment. Exact addresses are in [addresses.json](addresses.json).
- The pinned SDK hashes UTF-8 action bytes with `keccak256 >> 8`. A wallet signal
  hashes its20 address bytes the same way. The on-chain prose omits the shift;
  [SOURCES.md](SOURCES.md) records the verified SDK/protocol mapping.
- `expires_at_min` is a proven credential-expiry lower bound. Request it at the
  server challenge expiry. The gate requires that lower bound to remain current;
  server nonce TTL and one-time consumption are separate checks.
- AgentKit **0.2.1** resolves AgentBook on World Chain even when a signature or
  payment uses another chain. This starter explicitly uses World Chain EOAs and
  provides a quota-only402 flow without a paid fallback. CLI **0.2.0** still
  bundles its own legacy registration flow; a human World App step is required.

## Blockers and disclosure

Public, MIT-licensed starter kit published 2026-09-14; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency).

Missing Portal credentials and human/device proof prevent all four complete
component receipts. Live Portal setup screenshots are not available without
that account/session; follow the official links in each component instead of
using fabricated setup images. The current v4 on-chain demo supports staging
and production, with no published on-chain sandbox address configured.

Original starter code is [MIT licensed](LICENSE); dependencies retain their
[own terms](THIRD-PARTY-NOTICES.md). Publication evidence and reuse disclosure
are in [PRIOR-ART.md](PRIOR-ART.md). Preserve the exact reused version and new
event work; a tested template does not certify prize eligibility.
