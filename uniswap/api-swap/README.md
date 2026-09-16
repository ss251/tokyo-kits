# Uniswap API swap starter

**Last proven: 2026-09-17 05:53 JST (2026-09-16T20:53:54Z)** — [receipt](receipts/base-latest.json). An authenticated `/quote` → `/swap` payload for 0.001 WETH → USDC was executed on a Base fork pinned at upstream block 51401337 through the official Universal Router 2.1.1: transaction `0x9ddd47ad9f92609cd7ea0976886a621ee25386079d6ab35cc7060edc9690441e`, 1000000000000000 wei WETH in, 2407071 USDC units out against a 2395035 minimum, after one Permit2 approval. The API key stays in the ignored `.env`; the receipt records request IDs, fork provenance, and source-file hashes only.

This generic MIT template prepares a same-chain swap through Uniswap's public `/quote` and `/swap` endpoints. It defaults to 0.001 WETH → USDC on Base, 0.5% slippage, V3/V4 pools, and Universal Router 2.1.1. Shared contract addresses and exact SDK pins are in [addresses.json](../addresses.json) and [package.json](../package.json).

```text
quote request → CLASSIC quote → bounded Permit2 signature when requested
             → /swap → UNSIGNED_NOT_EXECUTED payload
             → shared fork executor → confirmed transaction + token balance effects
```

## Quickstart

From `uniswap/`, install the pinned dependencies using the parent README, then copy `.env.example` to the ignored `.env` if it does not already exist. Obtain an API key through the [Uniswap Developer Platform dashboard](https://developers.uniswap.org/dashboard), confirm trading access, and set `UNISWAP_API_KEY` in that ignored file. The demo uses an ephemeral fork wallet; a production wallet private key is unnecessary.

```sh
cd api-swap
make test
make demo
```

Both commands use the shared serial runner. Missing credentials make `make demo` fail with `NOT PROVEN`; a successful HTTP response alone cannot complete the demo. The execution runner must fund the fork wallet, establish ERC20 → Permit2 allowance, review the unsigned transaction, execute it against the pinned official router, and verify WETH decreased and USDC increased.

## Reuse

[client.ts](client.ts) exports `buildQuoteRequest`, `requestQuote`, `requestSwap`, and `prepareSwap`. [demo.ts](demo.ts) exports `runApiSwap({ walletAddress, signPermit })` for the shared fork runner. Its return value is a `PreparedSwap` with `transaction`, the original `request`, the validated `quoteResponse`, and API `requestIds`.

```ts
const prepared = await runApiSwap({ walletAddress, signPermit });
// prepared.status is always 'UNSIGNED_NOT_EXECUTED'.
// Pass prepared.transaction to the shared fork executor; it owns receipt checks.
```

`signPermit` receives the API's typed data only after the client checks the Permit2 domain, input token, spender, PermitSingle schema, and bounded amount. Base defaults to the router in `addresses.json`; other chains require an explicitly verified `expectedPermitSpender`. The signer should use `domain`, `types`, `values` (as the typed-data `message`), and `primaryType: 'PermitSingle'`. A null permit causes both `signature` and `permitData` to be omitted from `/swap`.

The API key is read only from the environment, is never returned, and is sent only to the fixed official host. `fetch` injection exists solely for offline unit testing. The client forwards the original quote intact, including fields it does not interpret. It validates fields needed for this workflow, not every possible future route field. The executor independently checks the destination, calldata effects, value, receipt status, and token balances.

## Gotchas and receipts

- `x-universal-router-version: 2.1.1` stays identical across `/quote` and `/swap`. Keep the same version for any `/check_approval` call you add.
- Only `CLASSIC` AMM routes are supported. UniswapX responses require `/order`; this starter rejects them.
- Amounts are atomic-unit strings; slippage is a percent (`0.5` means 0.5%). The request uses `permitAmount: EXACT`.
- API simulations see the public chain, while demo funding and approvals exist on the fork. `/swap` therefore requests `simulateTransaction: false`; the executor must simulate and execute on its own fork. A quote's simulation warning is not an executed failure or success receipt.
- A fork can drift from the public block used for the quote. Use a fresh fork, bounded slippage, and a recent quote. Re-request after price movement or expiry.

The receipt above records the date, fork chain/block, official router address, API request IDs, the successful transaction receipt, and before/after token balances. A fork hash is verifiable by replaying the recorded fork; it will not appear in a public block explorer. API keys and permit signatures are never saved in receipts. Rerunning `make demo` refreshes the receipt against a new fork block and a fresh quote.

## Which idea would use this?

Use this component when a hackathon app needs a wallet swap or a swap step before another contract action. The starter supplies transport, typed request construction, permit handling, and unsigned transaction validation. Add the app's own user flow and product logic during the event, and disclose this pre-existing component.

## Official sources and disclosure

Verified 2026-09-14: [integration guide](https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide), [quote reference](https://developers.uniswap.org/docs/api-reference/aggregator_quote), [swap reference](https://developers.uniswap.org/docs/api-reference/create_swap_transaction), and [public OpenAPI specification](https://trade-api.gateway.uniswap.org/v1/api.json). Only public fields are used; fields marked `x-internal: true` are excluded.

Original starter code is [MIT licensed](../LICENSE). Disclose reuse using [PRIOR-ART.md](../PRIOR-ART.md). Complete the shared [FEEDBACK.md](../FEEDBACK.md) and [Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) for the Uniswap track.

Credential preflight was executed on 2026-09-14 JST and failed nonzero with `NOT PROVEN: missing UNISWAP_API_KEY`, before compilation or a service request. With a Developer Platform key in place the same command completed end to end on 2026-09-17 JST; see the receipt linked above.
