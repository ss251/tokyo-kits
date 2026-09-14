# Tokyo integration kits

Generic integration starters prepared before ETHGlobal Tokyo 2026. Original
starter code is MIT licensed; dependencies retain their own licenses.

Public repository: [ss251/tokyo-kits](https://github.com/ss251/tokyo-kits). **11 of 19 sponsor components are proven**; the other eight have runnable implementations, tests, and explicit missing-prerequisite records.

**Latest validation: 341 tests passed**, plus three common fork canaries. [Check report](common/receipts/check-all-latest.json).
The same 341 tests passed after installing from a clean public clone on
2026-09-14: [reproduction receipt](common/receipts/public-clone-latest.json).

Pick the behavior your idea needs, open its starter, and follow that README's
quickstart. The Tokyo column links to the official sponsor prize card; these
19 components are reusable building blocks, not 19 separate awards.

| Your idea needs… | Start here | Tokyo prize track | Evidence |
| --- | --- | --- | --- |
| Custom liquidity with tokens kept in makers' wallets | [Aqua app](aqua/app-open/) | [1inch: Aqua][prize-aqua] | Proven: Polygon + Base forks |
| A programmable pricing instruction | [Aqua opcode](aqua/swapvm-opcode/) | [1inch: Aqua][prize-aqua] | Proven: custom opcode + official-router Extruction |
| Pegged settlement in an existing app | [Aqua Continuity](aqua/continuity-recipe/) | [1inch: Aqua, Continuity][prize-aqua] | Proven: SDK pegged strategy |
| Pool-specific fees and swap events | [Uniswap v4 hook](uniswap/v4-hook/) | [Uniswap: stack contribution][prize-uniswap] | Proven: Base fork |
| An API-powered quote-and-swap screen | [Uniswap swap API](uniswap/api-swap/) | [Uniswap: stack contribution][prize-uniswap] | NOT PROVEN: API key |
| Creating and managing liquidity positions | [Uniswap LP API](uniswap/lp-api/) | [Uniswap: stack contribution][prize-uniswap] | NOT PROVEN: API key |
| A swap through an existing pool | [Uniswap v3/v2](uniswap/v3-or-v2/) | [Uniswap: stack contribution][prize-uniswap] | Proven: v3 on Base fork |
| A continuous token auction | [Uniswap CCA](uniswap/cca/) | [Uniswap: stack contribution][prize-uniswap] | Proven: Base fork |
| Routed swaps in an existing product | [Uniswap Continuity](uniswap/continuity-recipe/) | [Uniswap: stack, Continuity][prize-uniswap] | Proven: Base fork |
| Names, subnames, and app configuration | [ENSv2 new app](ens/new-app-ensv2/) | [ENS: Best Use of ENSv2][prize-ens] | Proven: Sepolia fork |
| ENS records replacing address-only configuration | [ENSv2 existing app](ens/add-to-existing/) | [ENS: ENSv2, Continuity][prize-ens] | Proven: Sepolia fork |
| An authenticated mini app inside World App | [World MiniKit](world/minikit-app/) | [World: details TBD][prize-world] | NOT PROVEN: Portal + human steps |
| A unique-human gate for an on-chain action | [World ID](world/world-id-verify/) | [World: details TBD][prize-world] | NOT PROVEN: Portal + human proof |
| Access for a human-registered agent | [World AgentKit](world/agentkit/) | [World: details TBD][prize-world] | NOT PROVEN: registered agent |
| Human verification in an existing app | [World Continuity recipe](world/continuity-recipe/) | [World: details TBD][prize-world] | NOT PROVEN: Portal + human proof |
| Stablecoin checkout with sponsored gas | [Sui payments](sui/payments/) | [Sui: DeFi & Payments][prize-sui] | Proven: official USDC, public Testnet |
| Escrow with approved release and timed refund | [Sui DeFi](sui/defi/) | [Sui: DeFi & Payments][prize-sui] | Proven: SUI, public Testnet |
| Contract deployment and read/write through an API | [MultiBaas basics](curvegrid/multibaas-basics/) | [Curvegrid: details TBD][prize-curvegrid] | NOT PROVEN: service credentials |
| Indexed contract events delivered to a backend | [MultiBaas webhooks](curvegrid/events-webhooks/) | [Curvegrid: details TBD][prize-curvegrid] | NOT PROVEN: credentials + HTTPS callback |

In the official-page snapshot captured on 2026-09-14, World and Curvegrid
have not published prize categories or qualification details. Their rows describe technology components; no award split or
Continuity eligibility is assumed. Sui's link uses the official prize index
because its separate detail page is incomplete. Recheck the linked cards when
submitting, and disclose the starter code you reuse.

For one integration, install dependencies from its sponsor folder, then run
the component demo. For example:

```sh
make -C uniswap install
make -C uniswap/v4-hook demo
```

For the whole collection, run `make install-all` then `make check-all`.
Tests run sequentially: Aqua → Uniswap → World → ENSv2 → Sui → Curvegrid → common.
[Common plumbing](common/) supplies fork launchers and receipt checks;
`make demo-common` runs the Polygon, Base, and Sepolia canaries.

See [credential setup](common/CREDENTIALS.md) for the eight blocked components,
[evidence conventions](common/README.md), and the [AI-assisted build record](common/AI-USAGE.md).
Never commit credentials; copy `.env.example` locally. Build/test commands
check uptime, wait when load exceeds 25, and share a machine-local lock.

“Proven” means tests and an executed integration demo passed. Fork receipts
are local evidence, not public explorer transactions; common canaries and
World/Curvegrid partial checks do not prove sponsor integration. Each kit's
`PRIOR-ART.md` records publication separately from execution. Publication alone
does not establish event eligibility.

Target: all kits proven and public by **Sep 18 JST**. Missing prerequisites
remain explicit and do not delay publication of proven components.

Public, MIT-licensed starter kit published 2026-09-14 JST; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency). All seven kit folders were public by **2026-09-14 10:05:04 JST**, revision [`dc49e72`](https://github.com/ss251/tokyo-kits/tree/dc49e728ec8eb35b33b61002605874fcba88218d). Each kit's `PRIOR-ART.md` retains its earlier first-public timestamp.

[prize-aqua]: https://ethglobal.com/events/tokyo2026/prizes/1inch
[prize-uniswap]: https://ethglobal.com/events/tokyo2026/prizes/uniswap-foundation
[prize-ens]: https://ethglobal.com/events/tokyo2026/prizes/ens
[prize-world]: https://ethglobal.com/events/tokyo2026/prizes/world
[prize-sui]: https://ethglobal.com/events/tokyo2026/prizes#sui
[prize-curvegrid]: https://ethglobal.com/events/tokyo2026/prizes/curvegrid
