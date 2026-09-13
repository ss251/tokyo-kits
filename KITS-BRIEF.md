# KITS BRIEF — ETHGlobal Tokyo integration starter kits (Astra, build thread)

Owner: Astra (Codex), build thread. Repo: `~/Developer/tokyo-kits` (this repo). Research context lives in `~/Developer/tokyo-warroom` (read `astra/01-*.md`, `astra/05-*.md`, `astra/17-*.md`, `astra/20-*.md` as they land; `inbox/` for prior research). Coordinate through `~/Developer/tokyo-warroom/inbox/FROM-FABLE.md` and `~/Developer/tokyo-warroom/astra/STATUS.md` (add a "Kits" section).

## Why
Sailesh: "for each ethglobal sponsor I need a working demo project for their integration — plug-n-play parts — during hackathon time no time should be wasted; any sponsor I think of integrating we should already have a headstart." Every hour saved on Friday night is worth more than any research line.

## Rules that bind
1. **Public before the event.** Each kit is a standalone, MIT-licensed, generic template with no product logic. Publish to GitHub (ss251 org/user) before Sep 25 so that using it in a submission is disclosed prior art. Lane 17 (ETHGlobal rules) decides the exact disclosure wording; until then, write `PRIOR-ART.md` in each kit stating what it is and when it was published.
2. **Working means proven.** A kit is done only when `make demo` (or `bun run demo`) executes the integration end to end against a fork or testnet and prints a transaction hash / verifiable receipt, and `make test` is green. Paste the receipt into the kit README under "Last proven".
3. **Official contracts and current SDK versions only**, pinned, with the exact addresses in `addresses.json`. No self-deployed replacements where the sponsor requires official contracts (1inch Aqua registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` and router `0x111111338c5091e8440b67b168bae16a668ac0de` on all 13 chains; Uniswap v4 addresses from developers.uniswap.org/contracts/v4/deployments).
4. **Machine load.** Check `uptime` before builds; one build or test run at a time; `nice -n 19` for compilers. If load > 25, wait.
5. **Never touch `~/Developer/slip`.** Do not modify `~/Developer/tokyo-warroom` except `astra/STATUS.md` (Kits section) and `inbox/FROM-FABLE.md` replies.
6. Commit small and often (`kits: <sponsor> <step>`). No secrets in git: `.env.example` only; document where to get keys.

## Kits (build in this order; each is its own folder with README, PRIOR-ART.md, addresses.json, .env.example, scripts, tests)

1. **`aqua/` — 1inch Aqua / SwapVM.** Foundry project on a Polygon fork (and Base fork as alternate): (a) Path B: ship a `concentrated` or `pegged` strategy through the official `AquaSwapVMRouter` using `@1inch/swap-vm-sdk` + `@1inch/aqua-sdk`, then fill it as a taker; (b) Path A: a minimal custom `AquaApp` skeleton with `swapExactIn` (callback pattern), `ship()`/`dock()` scripts, and a taker contract implementing `IXYCSwapCallback`; (c) Path C: an `IExtruction` pricing target wired into a SwapVM program; (d) tests for quote()==swap() invariance and for maker custody (tokens leave the wallet only on fill). Document the SwapVM starter gotcha Astra found (starter deploys a fresh registry; Tokyo requires official).
2. **`uniswap/` — Uniswap stack.** (a) v4 hook template (BaseHook, dynamic fee, afterSwap event) with mined address + deploy script on a fork; (b) read scripts: StateView slot0/liquidity/tick bitmap, V4Quoter both directions (reuse `~/Developer/kesen-research-2026/evidence/jpyc-depth/scripts/depth.ts`); (c) swap through Universal Router with Permit2; (d) Uniswap API `/quote` + `/swap` example with `.env` key instructions; (e) `FEEDBACK.md` template and the Developer Feedback Form link; (f) CCA (whatever "CCA" in the Tokyo prize text refers to — find it in docs and include a minimal example if it is a public product).
3. **`ens/` — ENSv2.** Sepolia (or namechain testnet if that is where ENSv2 lives per Lane 01/20): register or claim a test name, set/read text and address records with the ENSv2 registry/resolver, mint a subname, resolve from a frontend with viem/ensjs; document what "non-cosmetic" use looks like and the in-person booth check from past events.
4. **`world/` — World.** (a) MiniKit mini-app skeleton (Next.js) with World ID verify (IDKit) and a server-side verification route; (b) World Chain testnet contract that gates a call on a verified proof; (c) AgentKit example per current docs (if AgentKit is the live product, show an agent performing an on-chain action under a World ID-bound identity); (d) Developer Portal app setup steps with screenshots.
5. **`sui/` — Sui DeFi & Payments.** Move package: a payment/escrow object with release conditions; TS client with `@mysten/sui` to publish, create, release; sponsored transactions or zkLogin note; devnet/testnet deploy script; tests via `sui move test`.
6. **`curvegrid/` — Curvegrid MultiBaas.** Free-tier deployment steps, link a contract, call read/write via REST, subscribe to events/webhooks, TypeScript client snippet; note Tokyo-specific info when the prize page publishes.
7. **`common/` — shared plumbing.** Wallet/env conventions, fork scripts (anvil with Polygon/Base/Sepolia RPCs), a `receipts/` convention for proof hashes, a one-command `make check-all` that runs every kit's tests, and a top-level README that says which kit to grab for which idea.

## Deliverable per kit
- README: 5-minute quickstart, architecture diagram (ASCII is fine), gotchas, official links, "Last proven" receipt with date.
- `make demo`, `make test` (or bun equivalents) green on this machine.
- Published public repo URL recorded in `~/Developer/tokyo-warroom/astra/STATUS.md` under Kits.

Start with `aqua/` and `uniswap/` (highest prize weight and most contract surface), then `world/`, `ens/`, `sui/`, `curvegrid/`, `common/`.
