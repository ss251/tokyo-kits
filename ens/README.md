# ENSv2 integration starters

Two generic examples use ENSv2 names as application configuration and scoped
permissions on the current official Sepolia deployment. Original code is MIT;
upstream licenses remain in force.

| Component | Which idea would use it? | State |
| --- | --- | --- |
| [New app](new-app-ensv2/) | Owner-managed recipient, enabled state and limits under an issued subname | Validation in progress |
| [Add to an existing app](add-to-existing/) | Replace literal configuration with resolved records using the same app boundary | Validation in progress |

## Five-minute quickstart

Requires Bun1.3.14, Node24.15.0, Anvil1.5.1 and Python3.12.

```sh
cd ens
make install
make test
make demo
make build
make dev
```

The defaults use a public Sepolia RPC and need no account or private key.
Optional archive endpoints belong in an ignored `.env` copied from
[.env.example](.env.example). The demo creates ephemeral local wallets, forks
Sepolia at a recorded block, mints the official test MockUSDC, and pays the
actual registrar. No official code or registry storage is replaced.

Build/test wrappers check uptime, wait above load25 and run at nice19 with
one shared Tokyo Kits lock. The Next build uses one worker.

```text
Official factory → resolver + user-registry proxies
Official registrar ← commitment / age window / exact MockUSDC fee
      ↓ parent.eth → linked user registry → app.parent.eth
Official Universal Resolver → address + app:enabled / app:limit / app:label
      ↓ fixed-block validation
Same application component ← literal baseline or ENS configuration
Scoped text delegate → allowed key update / forbidden writes / revocation
```

## Browser and fork state

`make dev` opens the shared Next.js integration lab at localhost3000. It
resolves public Sepolia state by default. The action preview is local JSON;
it is not an on-chain identity or permission check. The CLI separately proves
the registry/resolver writes and permission enforcement.

For a browser view of freshly created fork names, build the UI first, then
run `KEEP_FORK_ALIVE=true make demo`. Read the name from the receipt and
RPC from `.run/ui-fork.json`. Start the built Next server with `ENS_RPC_URL`
set to that local URL and optionally `ENS_DEMO_NAME` set to the receipt name.
Stop the demo with Ctrl-C when finished. A retained demo owns the shared
build lock, so finish builds before retaining it. No keys are written to that
state file.

## Last proven

PENDING validated fork receipts and tests. Each component's `make demo`
writes its own `receipts/sepolia-latest.json` after all assertions pass.
Local-fork hashes are evidence in those files, not public explorer hashes.

A public live-demo URL and public Sepolia name are separate event submission
requirements and are not claimed by fork proof. Use the component guides for
hosting and live-name steps. No missing live URL is presented as a working
public deployment.

## Current deployment traps

- The canonical deployment page now pins contracts-v2 commit
  `97a57293f3b4279d94b571e678edb53ce62638f4`. Older preview address tables are
  stale for this snapshot. The current Universal Resolver is
  `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`.
- Reads use pinned viem2.56.5. Writes use exact official deployment ABIs;
  `scripts/fetch-abis.py --check` verifies their SHA256 hashes offline.
- ENSv2 token IDs can change. Discover the current token ID before writing
  registry settings. A child registry must be linked from its parent.
- Resolver `grantRoles` is disabled in this deployment. Use the actual scoped
  `authorizeTextRoles` interface for text delegation; this demo grants only
  `app:limit` and proves denial for another key, address changes and revocation.
- All app reads use the same block. Missing/malformed records fail closed.
  Text is never evaluated or fetched as a URL. CCIP-Read is explicitly disabled
  for this on-chain-only template; off-chain names are outside its coverage.

See [SOURCES.md](SOURCES.md), [addresses.json](addresses.json), and
[PRIOR-ART.md](PRIOR-ART.md). This is generic pre-event code; disclose the
precise reused commit and preserve the new event work separately.
