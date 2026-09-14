# V4 hook, pool reads, and router swap

A minimal `BaseHook` with immutable per-direction LP fees and an `afterSwap` event. The demo mines a real CREATE2 address, initializes a pool on the official Base PoolManager, mints liquidity through the official PositionManager, reads state, and swaps both directions through Universal Router 2.1.1 with Permit2.

## Last proven

**PROVEN** — [refreshed Base-fork receipt](receipts/base-latest.json): **2026-09-14 09:51 JST** (`2026-09-14T00:51:24.795Z`), upstream block **51278859**, hash `0xad90d215f7294e61e0fa78a62ba75881a25d40ebcf524f2e9e3786db740df3f3`. All 14 recorded transactions succeeded. Both V4Quoter results equal the measured output-token balance increases; the hook and official manager events record the expected 500/3000-pip fees.

| Direction | Input, atomic units | Output, atomic units | Local transaction hash |
| --- | --- | --- | --- |
| WETH → DAI | `10000000000000000` | `9994001099590095` | `0xd16d79a6599eaa50308ebf310d3549ce634034070396a7e64d8045a744340535` |
| DAI → WETH | `10000000000000000` | `9970998894649374` | `0x5959026c24b31bf815f7b9e961cb4e1ee257faba0dcaa74679ceee5ed54ac831` |

The refreshed receipt includes decoded PoolManager fee events and exact source-file hashes. It supersedes the earlier initial proof and records the dirty working-tree status honestly. Shared validation passed: TypeScript, 27 Bun tests, 15 local Solidity tests, and 15 official-fork Solidity tests. Local hashes are verified through the saved receipt and fork replay, not a public explorer.

## Quickstart

From the parent `uniswap/` folder, follow its dependency setup, then:

```sh
make -C v4-hook demo
make -C v4-hook test
```

The demo needs only Base RPC access. It creates disposable wallets and a loopback fork, checks machine load, and runs under the shared serial build lock. Optional parent `.env` settings are `BASE_RPC_URL` and `FORK_BLOCK_NUMBER`; do not supply a production key.

```text
HookFactory + exact init code → salt mining → DirectionalFeeHook
Official PoolManager.initialize → dynamic WETH/DAI pool
ERC20 approval → Permit2 → official PositionManager liquidity NFT
StateView + V4Quoter → Permit2 → Universal Router → hook + manager events
```

## Hook and pool behavior

[DirectionalFeeHook.sol](../src/DirectionalFeeHook.sol) enables `beforeInitialize`, `beforeSwap`, and `afterSwap`. Their exact permission bits are `0x20c0` under mask `0x3fff`. [HookFactory.sol](../src/HookFactory.sol) deploys with CREATE2; [v4.ts](../scripts/v4.ts) searches against that factory's address and exact init-code hash. The real `BaseHook` constructor validates the flags. Changing constructor arguments, bytecode, or factory requires mining again.

The pool key sets dynamic-fee flag `0x800000`. Initialization rejects static-fee keys. `beforeSwap` returns the selected fee with override flag `0x400000`: **500 pips (0.05%) for token0 → token1** and **3000 pips (0.3%) for token1 → token0**. It takes no hook token delta. These are immutable directional examples, not a market-reactive fee model. The per-swap override does not replace the stored dynamic LP fee, so `StateView.lpFee` can remain zero even when a swap pays a nonzero fee.

The demo's tokens are official Base WETH and DAI, both with 18 decimals. It initializes at `sqrtPriceX96 = 2^96`, tick 0, spacing 60, and supplies fixture liquidity between ticks -600 and 600. **The 1:1 WETH/DAI price is synthetic and must never be used as a market quote or price oracle.** Only local token balances and the new pool are fixtures; settlement uses official deployed contracts.

## Reads, settlement, and checks

[read.ts](../scripts/read.ts) calculates the pool ID and reads StateView slot0, active liquidity, and the bitmap word containing the current tick. Negative ticks use floor division. This is a one-word example, not a full initialized-tick scan. V4Quoter is called through simulation in both directions.

[v4.ts](../scripts/v4.ts) mints an NFT through the PositionManager and checks its owner. Each swap approves the exact input token amount to Permit2, authorizes the official router with an expiry, and sets a positive output minimum of 99% of its immediate quote. The router commands settle input and take output. With no intervening trade, actual input must equal requested input and actual output must equal the quote.

The updated script decodes `SwapObserved` and checks pool ID, router sender, direction, negative exact-input amount, signed token deltas, and configured fee. It independently checks the official PoolManager `Swap.fee` event. The `sender` event field identifies the router calling PoolManager; it is not a user identity.

Shared Solidity tests cover real swaps in both directions for exact input and exact output, invalid flags, duplicate salts, static pools, unauthorized callbacks, fee bounds, event deltas, and zero hook custody. Local unit tests deploy official-source PoolManager code; the separate integration tests use the official Base address. Both 15-test suites passed in the serialized verification run.

## Versions and official contracts

The hook imports `@openzeppelin/uniswap-hooks` **1.1.1**, `@uniswap/v4-core` **1.0.2**, and OpenZeppelin contracts **5.6.1**. The liquidity interface uses `@uniswap/v4-periphery` **1.0.3**. Encoding uses `@uniswap/v4-sdk` **2.3.3** with explicit `URVersion.V2_1_1` because that router's swap tuple includes `minHopPriceX36`. Omitting the version can encode the older tuple.

Base's PoolManager is `0x498581fF718922c3f8e6A244956aF099B2652b2b`; PositionManager is `0x7C5f5A4bBd8fD63184577525326123B519429bDc`; Universal Router 2.1.1 is `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7`. All remaining reader/token/Permit2 addresses are pinned in [addresses.json](../addresses.json), with official links in [SOURCES.md](../SOURCES.md).

## Which idea would use this?

Use this component when a project needs custom pool callbacks, swap observations, or an explicit fee rule integrated with Uniswap settlement. Replace the illustrative fee rule and synthetic pool assumptions with the project's own behavior during the event. Original code is [MIT](../LICENSE); disclose reuse through [PRIOR-ART.md](../PRIOR-ART.md) and complete [FEEDBACK.md](../FEEDBACK.md).
