# Add a Uniswap swap to an existing app

A one-hour integration recipe using the kit's plain V3 path. It keeps the existing app's wallet and user flow while adding a bounded WETH/USDC swap through official Base contracts. The executable example is [runV3](../scripts/v3.ts) with the receipt scenario `continuity-recipe`.

## Last proven

**PROVEN template** — [dedicated continuity receipt](receipts/base-latest.json), **2026-09-14 07:58 JST** (`2026-09-13T22:58:30.755Z`), Base upstream block **51275468**. Both deadline-multicall swaps and their exact-input approvals succeeded. Local hashes are `0xddef852cdf4ab042a20847e1ab1d35dee9cb058cd3fc4583e25f0c8a8633c3a6` (WETH → USDC) and `0xf729c3679f4523cb0bdb9d9796eeba1620f1326815470dc9c49bd0a27f93c340` (USDC → WETH). Quote, simulation, and actual received amounts match in both directions. The receipt includes source-file hashes and disclosed fork funding.

The shared validation run passed TypeScript, 19 Bun tests, 15 local Solidity tests, and 15 official-fork Solidity tests. This establishes the reusable template's behavior; an existing application's adaptation still needs its own execution proof. The combined run retained some USDC from the preceding V3 scenario, so the reverse trade uses half of the available balance, as implemented by `runV3`.

## Run the recipe

After installing dependencies from the parent `uniswap/` README:

```sh
make -C continuity-recipe demo
make -C continuity-recipe test
```

The demo creates its own local Base fork, uses ephemeral wallets, swaps both directions, checks quote/simulation/balance equality, and writes a receipt into this component's `receipts/` directory. It inherits the shared machine-load check and `nice -n 19` serial runner. Optional RPC/replay settings belong in the parent's ignored `.env`.

## One-hour plan

| Time | Action | Concrete result |
| --- | --- | --- |
| 0–10 min | Run this component's demo; inspect the official addresses, token decimals, and receipt assertions | A known working baseline on the same chain |
| 10–20 min | Connect the existing app's wallet to the quote and calldata construction in `scripts/v3.ts` | Typed token addresses, atomic input amount, selected recipient |
| 20–35 min | Add the exact allowance, fresh quote, positive minimum output, and deadline multicall | An unsigned swap the user can review and authorize |
| 35–45 min | Execute through a test wallet on a fork; inspect success status and before/after balances | A receipt proving the app's new integration path |
| 45–55 min | Run tests for wrong chain, stale quote, insufficient allowance, and user rejection in the app's existing test framework | Visible failure handling instead of a false success screen |
| 55–60 min | Record reused files/public revision and new event work; fill in Uniswap feedback | Transparent Continuity disclosure and code pointers |

Use the existing app's normal wallet authorization flow when adapting this beyond the fork. `anvil_setBalance`, `anvil_setStorageAt`, and disposable fork accounts belong only to the local test harness. Copy the public-client reads, quote parameters, allowance limit, and encoded router call rather than embedding the fork funding helper in the app.

```text
Existing app amount + wallet
     → verified pool / fresh quote
     → exact allowance + expiring swap
     → receipt status + received amount
     → existing app's next action
```

## Small integration boundary

The reusable transaction path in [v3.ts](../scripts/v3.ts) needs `tokenIn`, `tokenOut`, `amountIn`, `recipient`, pool fee `500`, a positive `amountOutMinimum`, and a deadline. Verify the connected chain is Base (`8453`). Resolve the pool through the official factory and preserve atomic-unit arithmetic. The current helper uses an ERC20 approval to SwapRouter02 followed by a deadline multicall containing `exactInputSingle`.

If the project needs V4 callbacks instead, follow [v4-hook](../v4-hook/README.md) and its separate Permit2/Universal Router flow; deploying a custom hook is beyond this recipe's hour. If it needs API route selection, use [api-swap](../api-swap/README.md), whose credentialed path remains NOT PROVEN. A generic transaction hash, API payload, or starter test result does not prove the existing app's new behavior.

## Which idea would use this?

Use this recipe when an already-built payment, wallet, or token-management app needs a swap before its existing action. The event work should make that new behavior useful to the app's users. Keep this starter's pre-event plumbing and the app's newly built integration clearly identified in the submission.

Official addresses and pinned versions are shared in [addresses.json](../addresses.json), [package.json](../package.json), and [SOURCES.md](../SOURCES.md). Original code is [MIT](../LICENSE). Record reuse in [PRIOR-ART.md](../PRIOR-ART.md), complete [FEEDBACK.md](../FEEDBACK.md), and submit the [Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback). Track eligibility is determined by the event's published rules, not by this recipe.
