# Continuous Clearing Auction

Create and complete an auction through Uniswap's official **CCA v2.1.0 factory on a Base fork**. This example supplies synthetic DAI inventory and one native ETH bid, checkpoints issuance, exits the bid, claims tokens, and sweeps proceeds and unsold tokens. The configured prices are illustrative; they are not market quotes.

An app launching a token or distributing a fixed inventory could use this example to replace a single opening-price sale with scheduled issuance and continuously updated clearing prices. It covers the CCA component of the Uniswap Stack track. It is generic integration plumbing prepared before the event.

## Quickstart

Install the parent kit's dependencies and Foundry as described in `../README.md`, then:

```sh
cd uniswap/cca
make demo
make test
```

The shared runner checks machine load and serializes work. A fresh local Anvil instance forks Base, creates disposable wallets, and writes `receipts/base-latest.json`. No private key is required. Set `BASE_RPC_URL` in the parent `.env` if the public endpoint cannot serve the selected fork block; see `../.env.example`.

## Flow

```text
Maker → official CCA factory.create → predicted CREATE2 auction
Maker → DAI.transfer(auction) → auction.onTokensReceived()
Bidder → submitBid{value: ETH}(maxPrice, amount, owner, previousTick, hookData)
Checkpoints → scheduled issuance → final checkpoint → graduation
exitBid → currency refund to bidder
claimTokens → purchased DAI to bidder, after claimBlock
Maker → sweepCurrency + sweepUnsoldTokens
```

The factory is `0x000000001F26a0044BaA66024e7b6599c61963F8`; the auction it creates is a real factory deployment on the local fork. No protocol bytecode is replaced. Native ETH bidding avoids an additional ERC20/Permit2 approval path. DAI balances are a disclosed local fixture, and every inventory transfer and auction transaction is retained in the receipt.

## Schedule and settlement details

- A step is packed as **3 bytes `uint24 mps` followed by 5 bytes `uint40 blockDelta`**, in big-endian order. `mps` is issuance **per block**, in ten-millionths. The sum of `mps × blockDelta` must equal `10,000,000`; durations must exactly cover `startBlock` to `endBlock`.
- The demo uses 20 blocks with zero issuance to admit the first bid, then 100 blocks at 100,000 mps each. `startBlock` is inclusive; bids at `endBlock` are rejected. Claims become valid at `claimBlock`, which follows the end by 10 blocks.
- `create` does not transfer inventory. Transfer the full token supply, then call `onTokensReceived`. Prices are Q96 ratios of atomic currency units per atomic sale-token unit; both floor and bid prices must align to tick spacing.
- This single-bid case ends below the bid's maximum price, so it uses `exitBid`. Bids equal to or below the final clearing price need `exitPartiallyFilledBid` and checkpoint hints; that branch is outside this minimal example.
- Exiting records the purchased amount and refunds unspent currency. Claiming transfers tokens to the bid owner. Repeated claims pay nothing; repeated exits and currency sweeps revert.
- Protocol fees are read by the auction from its configured controller at sweep time. The receipt records actual creator proceeds, protocol fee, and any atomic rounding dust instead of assuming fees are zero.

The runner checks exact revert reasons for premature bidding/exit/claim and unauthorized/repeated sweeps. It asserts the factory's predicted address, inventory receipt, checkpoint progress, graduation, actual claimed tokens, refunds, creator proceeds, and conservation of token inventory and bid currency.

## Last proven

Proven **2026-09-14 09:51 JST** (`2026-09-14T00:51:31.926Z`) on Base upstream block **51278859**, hash `0xad90d215f7294e61e0fa78a62ba75881a25d40ebcf524f2e9e3786db740df3f3`. Official-factory creation: `0x18f8b1fe4fdc0c0c116bf98f27874afcf0fd33277ea007909a86929f30d7e132`; purchased-token claim: `0x16062280cefb3a78d122c9c31e205fbeae23cdf3dd69958e533f5b1e07a9b542`. [Full receipt](receipts/base-latest.json) includes all 12 successful transactions, negative boundary probes, inventory/proceeds reconciliation and source hashes. These local hashes do not appear on a public block explorer. Six CCA boundary tests and the parent kit's complete 57-test suite passed.

This run claimed `100000000000000000000` DAI atomic units from a `1000000000000000000000` inventory, returned `899999999999999999999` unsold units, and retained one atomic unit of token dust. The `1000000000000000000`-wei bid became the same amount of creator proceeds; refund, protocol fee, and currency dust were zero in this recorded run.

## Blockers

None for this implemented lifecycle. A missing official factory at the selected block, RPC failure, or changed protocol behavior fails the demo explicitly.

## Official sources and license

- [CCA v2.1.0 source](https://github.com/Uniswap/continuous-clearing-auction/tree/v2.1.0)
- [Auction interfaces and parameters](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/interfaces/IContinuousClearingAuction.sol)
- [Step packing](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/libraries/StepLib.sol)
- [Liquidity Launchpad deployments](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments)

Original example code is MIT licensed under `../LICENSE`. Disclosure and publication status are recorded in `../PRIOR-ART.md`.
