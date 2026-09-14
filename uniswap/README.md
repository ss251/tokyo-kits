# Uniswap stack integration starters

Generic MIT starters for the Uniswap Stack and Continuity tracks at ETHGlobal Tokyo 2026. They share pinned dependencies, official Base deployments, and a serial fork runner. Four on-chain components are proven; two credentialed API components remain blocked.

## Coverage and last proven

Status checked **2026-09-14 09:51 JST** (`00:51 UTC`). The refreshed on-chain run succeeded against Base upstream block **51278859**, hash `0xad90d215f7294e61e0fa78a62ba75881a25d40ebcf524f2e9e3786db740df3f3`. Component receipts were recorded from `2026-09-14T00:51:24.795Z` through `2026-09-14T00:51:32.220Z`.

| Component | Use it for | Evidence / current status |
| --- | --- | --- |
| [v4-hook](v4-hook/README.md) | Hook callbacks, directional fees, StateView, V4Quoter, Permit2, Universal Router | **PROVEN**: [14 successful transactions](v4-hook/receipts/base-latest.json), both swap directions and actual manager fee events |
| [api-swap](api-swap/README.md) | Authenticated `/quote` → `/swap` integration | **NOT PROVEN**: API credential absent |
| [lp-api](lp-api/README.md) | Create, increase, decrease a V3/V4 LP position | **NOT PROVEN**: API credential absent; management requires a public-chain NFT |
| [v3-or-v2](v3-or-v2/README.md) | A plain V3 pool swap with minimal dependencies | **PROVEN**: [4 successful transactions](v3-or-v2/receipts/base-latest.json), quotes equal balance deltas with deadline multicalls |
| [cca](cca/README.md) | Continuous Clearing Auction deployment and settlement | **PROVEN**: [12 successful transactions](cca/receipts/base-latest.json), factory creation through claim and proceeds/inventory sweeps |
| [continuity-recipe](continuity-recipe/README.md) | Add a bounded V3 swap to an existing app in about one hour | **PROVEN template**: [dedicated 4-transaction receipt](continuity-recipe/receipts/base-latest.json); application-specific adaptation is future work |

Validation passed: strict TypeScript checking, **27 Bun tests**, **15 local Solidity tests**, and **15 tests against the official Base PoolManager**. The four refreshed receipts contain source-file hashes, runtime hashes, fork block provenance, and disclosed fixture funding. They record source commit `d1373ca2e00b74231b26fbfa114f0bdbe4bef9b2` with `sourceDirty: true`, so identify the executed files through `sourceFilesSha256` rather than the commit field alone. API unit fixtures are explicitly synthetic; they are not authenticated service results.

## Five-minute setup

Use Bun, Foundry (`forge` and `anvil`), Python 3, and Git. The build environment uses Bun 1.3.14 and Foundry 1.5.1. Python must support `tarfile.extractall(..., filter='data')` for dependency bootstrapping. From this repository:

```sh
cd uniswap
make install
# Optional: create an ignored .env from .env.example if one does not exist.
make -C v4-hook demo
make -C v3-or-v2 demo
make test
```

The public Base RPC is the default. Set `BASE_RPC_URL` in the ignored `.env` when archive access or rate limits require another endpoint. Set `FORK_BLOCK_NUMBER` to replay a recorded upstream block. Demos create fresh, disposable local wallets; no wallet private key or faucet is needed. Fork transactions are submitted only to loopback Anvil.

`make demo` runs every component, including credentialed APIs, and fails when a required path cannot complete. Target one component as above while blocked paths remain unresolved. `make test` runs strict TypeScript checks, Bun unit tests, local Solidity tests, then the Solidity tests against the official Base PoolManager on a managed fork. Every component's test target delegates to that shared suite, except the API folders' focused offline tests.

All commands pass through [serial.py](scripts/serial.py), which takes the shared Tokyo Kits build lock, checks `uptime`, waits while load exceeds 25, and runs the process under `nice -n 19`. The internal runner checks load again before each compiler/test command.

## What runs where

```text
Pinned TypeScript SDKs / REST clients
       ↓ unsigned calls
Managed Base fork + disposable wallets
       ├─ official PoolManager / PositionManager / StateView / V4Quoter
       ├─ official Permit2 / Universal Router 2.1.1
       ├─ official V3 factory / QuoterV2 / SwapRouter02
       └─ official CCA factory → new auction instance
       ↓ receipt status, events, token/NFT effects
<component>/receipts/base-latest.json
```

The V4 demo creates an illustrative WETH/DAI pool at a synthetic 1:1 price on the official manager. Its prices and liquidity are test fixtures, not market data or an oracle. The V3 demo uses the already deployed WETH/USDC 0.05% pool. ERC20 fixture balances are installed only on the local fork, and the receipt discloses each storage mutation. Protocol runtime bytecode is not replaced.

## Pins and addresses

Exact versions are in [package.json](package.json), resolved packages/integrities in [bun.lock](bun.lock), Solidity helper commits in [solidity-dependencies.json](solidity-dependencies.json), and deployed Base addresses in [addresses.json](addresses.json). The compiler is pinned to Solidity 0.8.26, Cancun, optimizer 200, and `viaIR`. [SOURCES.md](SOURCES.md) links every official implementation and explains the router-version and API documentation mismatches.

## Receipts and disclosure

Successful demos write the actual transactions and receipts, origin chain/block hash, official contract hashes, compiler/dependency metadata, fixture funding, and measured effects under the component's `receipts/` directory. The current runner also hashes relevant source files. Fresh ephemeral wallets make transaction hashes vary between replays; compare invariants and provenance, rather than expecting identical hashes. Local-fork hashes do not appear in a public block explorer.

Original code is [MIT licensed](LICENSE); dependencies retain the licenses documented in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Public location and actual publication status are recorded in [PRIOR-ART.md](PRIOR-ART.md); first publication was confirmed at 2026-09-14 08:10:17 JST, revision `b3a66767fc67909fc327336aa4086752ce68e3f6`. Disclose reused starter code and identify work added during the event. Complete [FEEDBACK.md](FEEDBACK.md), include relevant code links, and submit the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback). Publication and form submission are not implied by a local receipt.

Public, MIT-licensed starter kit published 2026-09-14 JST; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency). The MIT license covers original code; dependency terms remain in force.
