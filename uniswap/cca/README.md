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

Pending the parent kit's serialized Base-fork run. No successful execution is claimed until `receipts/base-latest.json` is present and the parent records the run here. The receipt contains local transaction hashes and receipts; these hashes do not appear on a public block explorer.

## Blockers

None confirmed during implementation. End-to-end execution and tests are awaiting the parent kit's serialized run. A missing official factory at the selected block, RPC failure, or changed protocol behavior fails the demo explicitly.

## Official sources and license

- [CCA v2.1.0 source](https://github.com/Uniswap/continuous-clearing-auction/tree/v2.1.0)
- [Auction interfaces and parameters](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/interfaces/IContinuousClearingAuction.sol)
- [Step packing](https://github.com/Uniswap/continuous-clearing-auction/blob/v2.1.0/src/libraries/StepLib.sol)
- [Liquidity Launchpad deployments](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments)

Original example code is MIT licensed under `../LICENSE`. Disclosure and publication status are recorded in `../PRIOR-ART.md`.
