# Uniswap source and deployment record

Verified from official sources on **2026-09-14**; API paths executed on **2026-09-17**. All six receipts prove their recorded source on Base forks and include source-file hashes.

## Exact package pins

The executable package set is fixed in [package.json](package.json) and [bun.lock](bun.lock). No SDK package uses a floating range.

| Package | Version | Official source |
| --- | --- | --- |
| `@uniswap/v4-core` | `1.0.2` | [Uniswap/v4-core](https://github.com/Uniswap/v4-core/tree/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc) |
| `@uniswap/v4-periphery` | `1.0.3` | [Uniswap/v4-periphery](https://github.com/Uniswap/v4-periphery/tree/60cd93803ac2b7fa65fd6cd351fd5fd4cc8c9db5) |
| `@openzeppelin/uniswap-hooks` | `1.1.1` | [OpenZeppelin/uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks/tree/bd5287c4a9f5c22c2393f7587a9b357662916115) |
| `@openzeppelin/contracts` | `5.6.1` | [OpenZeppelin/openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) |
| `@uniswap/v4-sdk` | `2.3.3` | [Uniswap SDK monorepo](https://github.com/Uniswap/sdks) |
| `@uniswap/v3-sdk` | `3.31.3` | [Uniswap SDK monorepo](https://github.com/Uniswap/sdks) |
| `@uniswap/sdk-core` | `7.19.2` | [Uniswap SDK monorepo](https://github.com/Uniswap/sdks) |
| `@uniswap/universal-router-sdk` | `5.11.5` | [Uniswap SDK monorepo](https://github.com/Uniswap/sdks) |
| `@uniswap/permit2-sdk` | `1.4.0` | [Uniswap SDK monorepo](https://github.com/Uniswap/sdks) |
| `viem` | `2.56.5` | [wevm/viem](https://github.com/wevm/viem) |
| `typescript` | `7.0.2` | [Microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| `@types/bun` | `1.4.2` | [Bun TypeScript documentation](https://bun.sh/docs/typescript) |

Solidity is pinned to **0.8.26**, Cancun, optimizer **200**, `viaIR`, in [foundry.toml](foundry.toml). The isolated helper archives are `forge-std` v1.11.0 commit [`8e40513d678f392f398620b3ef2b418648b33e89`](https://github.com/foundry-rs/forge-std/tree/8e40513d678f392f398620b3ef2b418648b33e89) and the official v4-core Solmate dependency commit [`4b47a19038b798b4a33d9749d25e570443520647`](https://github.com/transmissions11/solmate/tree/4b47a19038b798b4a33d9749d25e570443520647). [bootstrap.py](scripts/bootstrap.py) fetches only those immutable archives into ignored `lib/` paths.

## Base deployment addresses

Authoritative inventory: [Uniswap deployment JSON](https://developers.uniswap.org/deployments.json), [V4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments), and [Liquidity Launchpad deployments](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments). Chain ID is **8453**. The executable inventory is [addresses.json](addresses.json).

| Contract | Address |
| --- | --- |
| PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| V4 PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` |
| StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` |
| V4Quoter | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| Universal Router 2.1.1 | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` |
| Legacy Universal Router 2.0 | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| V3 factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| V3 SwapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| V3 QuoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| V3 NonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` |
| V3 WETH/USDC fee 500 pool | `0xd0b53D9277642d899DF5C87A3966A349A798F224` |
| CCA factory 2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` |
| WETH | `0x4200000000000000000000000000000000000006` |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

The runner verifies upstream chain and block hash, checks official deployed runtime presence, records runtime hashes, and verifies PositionManager's PoolManager reference. The V3 demo independently resolves its pool through the official factory. The new V4 hook and its new pool are demo-created objects on the official manager, not pre-existing official deployments.

## Implementation source pointers and mismatches

- `BaseHook`: [OpenZeppelin v1.1.1 source](https://github.com/OpenZeppelin/uniswap-hooks/blob/bd5287c4a9f5c22c2393f7587a9b357662916115/src/base/BaseHook.sol). Current hook permissions include `beforeInitialize`; the required mined bits are `0x20c0`, not just the two swap callback flags.
- Core operation parameters: [PoolOperation.sol](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/src/types/PoolOperation.sol). `SwapParams` is a standalone imported type in this pin.
- Universal Router **2.1.1** source: [`999d561c3ad58fb5cab91b602911f3c75591a9c7`](https://github.com/Uniswap/universal-router/tree/999d561c3ad58fb5cab91b602911f3c75591a9c7). Its V4 exact-input tuple includes `minHopPriceX36`. The starter passes `URVersion.V2_1_1` explicitly in [v4.ts](scripts/v4.ts); an older default can produce incompatible calldata.
- Initialization: some template revisions show a different PositionManager `initializePool` signature than npm periphery 1.0.3. The starter calls the official PoolManager's `initialize(PoolKey,uint160)` directly.
- State reads and quote simulation: [read.ts](scripts/read.ts) adapts the integer-preserving StateView/V4Quoter pattern from the user's pre-existing depth reader. It reads one bitmap word and never converts a failed quote into a fabricated price. The synthetic V4 pool is not price evidence.
- V3 router: [Uniswap/swap-router-contracts](https://github.com/Uniswap/swap-router-contracts). SwapRouter02's exact-input tuple omits a deadline, so [v3.ts](scripts/v3.ts) wraps the swap in an expiring multicall.
- CCA means **Continuous Clearing Auction**, a public Uniswap product. The minimal demo uses factory **2.1.0**, source [`7d7602d257733315434570f2a0c2f94f1c7b207a`](https://github.com/Uniswap/continuous-clearing-auction/tree/7d7602d257733315434570f2a0c2f94f1c7b207a). [StepLib](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/libraries/StepLib.sol) defines the issuance schedule packing. See [cca/README.md](cca/README.md) and the [successful lifecycle receipt](cca/receipts/base-latest.json) for factory creation, bid, checkpoint, exit, claim, and sweep behavior.

## Public APIs

The [public OpenAPI](https://trade-api.gateway.uniswap.org/v1/api.json) supplies request/response schemas. Only public fields are used; `x-internal: true` fields are excluded. REST APIs are hosted services and have no npm version pin; this document records the verification date and the clients validate their responses at runtime.

| Workflow | Official guide/reference | Endpoint |
| --- | --- | --- |
| Swap quote | [Quote reference](https://developers.uniswap.org/docs/api-reference/aggregator_quote) | `https://trade-api.gateway.uniswap.org/v1/quote` |
| Swap calldata | [Swap reference](https://developers.uniswap.org/docs/api-reference/create_swap_transaction) | `https://trade-api.gateway.uniswap.org/v1/swap` |
| LP create/increase/decrease | [Dedicated LP guide](https://developers.uniswap.org/docs/liquidity/liquidity-provisioning-api/integration-guide) | `https://liquidity.api.uniswap.org/lp/{create,increase,decrease}` |

The LP guide explicitly specifies a separate host with no version prefix, while the shared reference banner repeats the trading host. This kit follows the dedicated guide and leaves credentialed verification pending. `/lp/create` uses `batchPermitData`; `/lp/increase` uses `v4BatchPermitData`. The LP guide describes new-pool `initialPrice` as `sqrtRatioX96`; the schema description is less precise. These discrepancies are documented instead of silently substituted.

Both API components were **proven on 2026-09-17** with authenticated requests followed by execution of their returned transactions on Base forks; an unsigned payload, API request ID, or offline fixture is never treated as a transaction receipt. Live observations recorded in the code: the LP host above accepted the same dashboard key as the trading host, a full-range `/lp/create` returns `adjustedMinPrice` `"0"`, and LP minimums follow the official V3 SDK's price-based slippage. See the per-component READMEs for the public-NFT restriction on LP fork demos.

## License and event context

Original starter code is MIT. Upstream packages retain their own notices and licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Core and router source licenses are not replaced by the starter's MIT file. Public URL/publication status and reuse disclosure belong in [PRIOR-ART.md](PRIOR-ART.md). [FEEDBACK.md](FEEDBACK.md) links the [required developer feedback form](https://developers.uniswap.org/hackathon-feedback). Neither documentation nor local execution submits that form.
