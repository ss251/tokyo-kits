# Uniswap LP API starter

**Last proven: NOT PROVEN (2026-09-14).** No LP API credential is available in this build environment. There are no authenticated LP payloads or executed API transaction receipts. A public-chain NFT and its verified owner are also needed to demonstrate increase/decrease on a fork. Offline unit fixtures do not establish integration success.

This generic MIT template builds requests for V3/V4 `/lp/create`, `/lp/increase`, and `/lp/decrease`, then validates the unsigned transaction and returned token amounts. The create example uses the official Base WETH/USDC V3 0.05% pool, with a full usable tick range and 0.001 WETH as the independent amount. Contract addresses and dependency pins are shared with the parent kit.

```text
pool / existing NFT + wallet → LP request → unsigned transaction
                            → shared fork executor → confirmed receipt + NFT/liquidity effects
```

## Quickstart

Install the parent kit's pinned dependencies and create its ignored `.env` from `.env.example` if needed. Obtain access through the [Uniswap Developer Platform dashboard](https://developers.uniswap.org/dashboard). Set `UNISWAP_LP_API_KEY` for a separate LP entitlement, or `UNISWAP_API_KEY` if that key has LP access. The client prefers the LP key and falls back to the trading key; it never prints either.

```sh
cd lp-api
make test
make demo
```

The shared runner serializes work and runs on a managed Base fork. Missing credentials fail nonzero. This failure was reproduced before compilation or any API request on 2026-09-14 JST. This executor supports ERC20-only V3 calls and requests `withdrawAsWeth: true`; unsupported selectors or V4 LP execution fail explicitly. An unsigned API transaction has status `UNSIGNED_NOT_EXECUTED` and is never treated as a proof receipt.

## Request builders and execution interface

[client.ts](client.ts) exports `buildCreateRequest`, `buildIncreaseRequest`, `buildDecreaseRequest`, and their asynchronous `requestCreate`, `requestIncrease`, `requestDecrease` counterparts. Requests use the exact endpoint field names and include a wallet, chain ID, protocol, and bounded slippage. Each asynchronous call returns a prepared transaction, its request, validated response token amounts, and API request ID.

- Create requires exactly one `existingPool` or `newPool`, plus one `tickBounds` or `priceBounds`. An existing V3 pool uses its address; V4 uses a bytes32 pool ID. New pools specify `fee`, `tickSpacing`, `initialPrice`, and V4-only optional `hooks`. The dedicated guide describes `initialPrice` as an integer `sqrtRatioX96`; use that representation. Fee units should match the protocol's pool fee value (for example `500` for 0.05%), despite the schema's imprecise “basis points” label.
- Increase identifies an existing V3/V4 NFT through `nftTokenId`, its token pair, and an independent token amount in atomic units. `/lp/create` accepts `batchPermitData`; `/lp/increase` accepts `v4BatchPermitData`. Signatures and permit data must be supplied together.
- Decrease uses an integer `liquidityPercentageToDecrease` from 1–100. `withdrawAsWeth` is V3-only. Token addresses retain the pool's numeric order; reversing an NFT's token pair is rejected.

[demo.ts](demo.ts) exports `runLpApi({ walletAddress, position, independentToken })`. `position` contains a verified public-chain NFT's `protocol`, `nftTokenId`, `token0Address`, and `token1Address`. `independentToken` carries the increase amount explicitly so the starter does not assume token decimals. The function prepares `{ create, increase, decrease }`; the shared executor owns transaction submission and evidence. For execution between requests, call the individual client functions directly and request each payload immediately before use.

Before each LP action, follow the official [`/lp/check_approval` flow](https://developers.uniswap.org/docs/liquidity/liquidity-provisioning-api/integration-guide#approvals). Execute required approvals and validate/sign any returned permit before requesting the LP transaction. This starter's three endpoint helpers do not themselves sign permits, approve tokens, or spend funds.

## Fork limits and receipts

The public API reads public-chain state. A position created only on a fork cannot then be looked up through the public API for increase/decrease. Demonstrate create against an existing public pool, and demonstrate management against a separate existing public NFT whose owner is independently verified and impersonated only on the local fork. This proves the three endpoints, not an API-managed lifecycle of the newly created fork NFT. A complete create → increase → decrease lifecycle needs a chain supported by the API where the position actually exists, or an API instance that can read the fork.

The dedicated LP integration guide specifies `https://liquidity.api.uniswap.org` with no `/v1` prefix. The shared API reference/OpenAPI banner repeats the trading host. This client follows the dedicated LP guide and does not silently switch hosts on failure. Access or schema errors remain explicit blockers until a credentialed run resolves them.

The client validates sender, chain, nonempty calldata, native value, request ID, and response token ordering. The shared executor validates official NFPM calldata recursively, permits only the requested mutation/collection, binds the NFT/pair/range/recipient, enforces quote and request limits, and grants then revokes exact input allowances. It checks actual token deltas and minted NFT metadata as well as liquidity changes. Eight regression tests reject excess spending, unrelated calls, and weaker slippage protection. These checks have passed offline; the live API remains unproven. API `simulateTransaction: false` permits local fork preparation; it does not constitute execution proof.

For each proven endpoint, save the date, fork block, official destination, API request ID, successful transaction receipt, NFT ID, and before/after ownership or liquidity under the parent `receipts/` directory, then link it above. Keep fork-created and pre-existing public NFT IDs distinct. Do not store API keys or private signing material. Public transaction signatures in executed calldata are part of transaction evidence. A successful create receipt alone leaves increase/decrease NOT PROVEN.

## Which idea would use this?

Use this component for a liquidity onboarding flow or a position-management screen. It supplies request construction and validated transaction preparation so the event project can focus on its own choices about pools, ranges, amounts, and user interaction. The starter itself contains no portfolio policy or product logic.

## Official sources and disclosure

Verified 2026-09-14: [LP integration guide](https://developers.uniswap.org/docs/liquidity/liquidity-provisioning-api/integration-guide), [create reference](https://developers.uniswap.org/docs/api-reference/create_position), [increase reference](https://developers.uniswap.org/docs/api-reference/increase_position), [decrease reference](https://developers.uniswap.org/docs/api-reference/decrease_position), and [public OpenAPI specification](https://trade-api.gateway.uniswap.org/v1/api.json). Only public fields are used.

Original starter code is [MIT licensed](../LICENSE). Disclose reuse using [PRIOR-ART.md](../PRIOR-ART.md), complete [FEEDBACK.md](../FEEDBACK.md), and submit the [Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).
