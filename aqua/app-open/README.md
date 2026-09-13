# Custom Aqua app — open track

An independently authored constant-product `AquaApp` and payer-bound callback
taker. Settlement uses the official Aqua registry. Generic infrastructure for
an idea that needs its own pricing rule while makers retain their tokens until
a trade fills; no project-specific product is included.

## Five-minute quickstart

Requires Bun, Python 3.12+, and Foundry (forge/anvil) on PATH.

```sh
cd ..                      # aqua/
make install
cd app-open
make test
make demo
```

The demo starts and stops its own loopback-only Polygon fork, creates ephemeral
wallets, funds real DAI/WETH balances only on that fork, ships a strategy, fills
both directions, and docks. It asserts wallet custody during ship/dock and
checks that quote, simulated swap, and actual balance changes agree. Set
`FORK_CHAIN=base` to use Base; RPC variables are in `../.env.example`.

```mermaid
sequenceDiagram
  participant M as Maker
  participant A as Official Aqua
  participant P as ConstantProductApp
  participant T as CallbackTaker
  M->>A: Approve tokens; ship virtual balances
  T->>P: swapExactIn with minimum output
  P->>A: pull maker output to recipient
  P->>T: authenticated callback
  T->>A: push payer input to maker
  P->>A: verify expected input balance
  M->>A: dock strategy
```

The implementation is in `../src/ConstantProductApp.sol` and
`../src/CallbackTaker.sol`; the complete transaction sequence is in
`../scripts/demo.ts`. Ship data is `abi.encode(Strategy)` and the strategy key
is its keccak256 hash. Approval targets differ: maker → Aqua; payer → taker.

## Last proven

Proven 2026-09-14 JST on Polygon fork block **93756903**. First fill:
`0xf3fb2e5524c92f82a48d770733a260e05f1f23bd8047a3e0ac627a93c21e32d2`. [Full local-fork receipt](receipts/polygon-latest.json).

Shared tests are green: 35 unit + 24 fork + 5 SDK tests, with strict TypeScript checks.

## Gotchas

- A quote is not a maker-solvency guarantee: wallet balance and approval must
  still exist when filling. Docking invalidates the virtual balance.
- Fee-on-transfer/rebasing assets are unsupported. Demo tokens use 18 decimals.
- This template uses a callback authorization bound to payer, app, strategy,
  token pair and amount. Keep those checks when adapting it.
- The original code is MIT; imported Aqua code retains upstream licenses.

[Official Aqua](https://github.com/1inch/aqua) ·
[Disclosed prior art](../PRIOR-ART.md) · [Addresses](../addresses.json)

Base alternate proven on block **51275546**, first fill:
`0x68f55012aa7351eabb60ea1eb32435ad25bdb38dd328d7a6c4aa048ff22ccd6c`. [Base receipt](receipts/base-latest.json).
