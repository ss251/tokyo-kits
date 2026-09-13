# Plain V3 pool interaction

Quote and swap WETH/USDC in both directions using the official Base V3 factory, QuoterV2, and SwapRouter02. This component chooses V3 for the “V3 or V2” stack example; it does not claim a separate V2 integration.

## Last proven

**PROVEN** — [refreshed Base-fork receipt](receipts/base-latest.json): **2026-09-14 07:58 JST** (`2026-09-13T22:58:29.084Z`), upstream block **51275468**. All four recorded approval/swap transactions succeeded. In each direction, QuoterV2 output equals router simulation output and the actual received balance delta.

| Direction | Input, atomic units | Output, atomic units | Local transaction hash |
| --- | --- | --- | --- |
| WETH → USDC | `1000000000000000` | `2472429` | `0x22ff3d867842545e340d4348ac2f0477506f8f8dc541aeac7b044a82c0ed3d8c` |
| USDC → WETH | `1236214` | `499499388903519` | `0x974097947c089ccfc2497a6a3782ad2fe2b4af85d60a056d8dd33849a7354d65` |

The refreshed proof executes `multicall(deadline, [swapData])` with a five-minute deadline and contains exact source hashes, superseding the earlier direct-call receipt. Shared validation passed: TypeScript, 19 Bun tests, 15 local Solidity tests, and 15 official-fork Solidity tests. The receipt records a dirty source revision; its file hashes identify the executed code. These are local-fork hashes, not public-chain transactions.

## Quickstart

After the parent `uniswap/` dependency setup:

```sh
make -C v3-or-v2 demo
make -C v3-or-v2 test
```

`BASE_RPC_URL` optionally selects the Base archive RPC; `FORK_BLOCK_NUMBER` selects the replay block. The parent `.env` is ignored. The shared runner checks load, runs under `nice -n 19`, and uses an isolated Anvil fork with disposable wallets. No API key, faucet, or production wallet key is required.

```text
Factory.getPool(WETH, USDC, 500) → verify known pool
QuoterV2 simulation → exact ERC20 allowance → SwapRouter02 simulation
deadline multicall → receipt → compare input/output balance deltas
```

## What to copy

[v3.ts](../scripts/v3.ts) exports `runV3(fork, scenario?)`. It verifies the WETH/USDC 0.05% pool through the official factory, funds a local WETH fixture, then spends 0.001 WETH. The reverse trade spends half of the wallet's available USDC after the first trade. In this dedicated run that USDC came from the forward swap; a combined run can retain balances from earlier components. WETH has 18 decimals and USDC has 6; all arithmetic remains in atomic units.

For each trade, the script takes a fresh QuoterV2 result, requires a positive minimum output of 99% of that quote, and approves exactly the input amount to SwapRouter02. It simulates `exactInputSingle`, encodes the same arguments into the deadline multicall, waits for a successful receipt, and compares actual balances with both simulations. Quotes are snapshots of this fork's pool state; do not treat a recorded amount as a current price.

SwapRouter02's `exactInputSingle` tuple has no deadline member. The enclosing `multicall(uint256,bytes[])` supplies expiry. This plain V3 route uses direct ERC20 approvals to SwapRouter02; the separate V4 example demonstrates Permit2 and Universal Router.

## Official Base contracts

| Role | Address |
| --- | --- |
| V3 factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| WETH/USDC, fee 500 pool | `0xd0b53D9277642d899DF5C87A3966A349A798F224` |
| QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

The ABI calls use pinned `viem` **2.56.5**. The shared kit also pins `@uniswap/v3-sdk` **3.31.3** and `@uniswap/sdk-core` **7.19.2** for extensions. See [addresses.json](../addresses.json), [package.json](../package.json), and [official source links](../SOURCES.md).

## Which idea would use this?

Use this component for a wallet swap, a token conversion before a payment, or an existing app that needs a straightforward pool interaction. Start with the verified pool and bounded call construction, then add the event project's token selection and user flow. It contains no execution strategy or product policy. Original code is [MIT](../LICENSE), with reuse disclosed in [PRIOR-ART.md](../PRIOR-ART.md).
