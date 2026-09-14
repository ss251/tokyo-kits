# Tokyo integration kits

Generic integration starters prepared before ETHGlobal Tokyo 2026. Original
starter code is MIT licensed; dependencies retain their own licenses.

Public repository: [ss251/tokyo-kits](https://github.com/ss251/tokyo-kits). **11 of 19 sponsor components are proven**; the other eight have runnable implementations, tests, and explicit missing-prerequisite records.

**Latest validation: 341 tests passed**, plus three common fork canaries. [Check report](common/receipts/check-all-latest.json).

Install the pinned dependencies, then run every kit's tests sequentially:

```sh
make install-all
make check-all
```

Run `make demo-common` for shared fork canaries, or `make -C <component> demo` for a selected integration. See [credential setup](common/CREDENTIALS.md), [evidence conventions](common/README.md), and the [AI-assisted build record](common/AI-USAGE.md).

Build order: Aqua → Uniswap → World → ENSv2 → Sui → Curvegrid → common.

| Kit | Status | Proof |
| --- | --- | --- |
| [Aqua](aqua/) | Proven on Polygon and Base | [4 executed paths](aqua/README.md#last-proven), 64 tests |
| [Uniswap](uniswap/) | Four components proven; API access blocked | [Base fork receipts](uniswap/README.md#coverage-and-last-proven), 57 tests |
| [World](world/) | Implemented; Portal/human/agent credentials blocked | 59 tests; [partial fork wiring](world/README.md#last-proven) |
| [ENSv2](ens/) | Both components proven | [Sepolia fork receipts](ens/README.md#last-proven), 18 tests |
| [Sui](sui/) | Both components proven on public Testnet | [USDC + escrow receipts](sui/README.md#last-proven), 49 tests |
| [Curvegrid](curvegrid/) | Implemented; service credentials blocked | 60 tests; [partial fork receipt](curvegrid/README.md#last-proven) |
| [Common](common/) | Three fork canaries proven | [Polygon/Base/Sepolia receipts](common/README.md#last-proven), 34 tests |

Each kit must pass its tests and execute a fork or testnet demo before it is
marked proven. Fork receipts are local evidence and cannot be found on a
public block explorer. Each kit's `PRIOR-ART.md` records publication separately
from execution. Existing templates must be disclosed when used at the event;
publication alone does not establish event eligibility.

Never commit credentials. Copy `.env.example` locally. Build/test commands
check uptime, wait when load exceeds 25, and share a machine-local lock.

Target: all kits proven and public by **Sep 18 JST**. Unproven components remain
explicitly marked and never delay publication of proven ones.

| Sponsor track / component | Subfolder | Use for | State |
| --- | --- | --- | --- |
| Aqua open app | [aqua/app-open](aqua/app-open/) | Custom wallet-custodied liquidity and settlement | Proven |
| Aqua opcode extension | [aqua/swapvm-opcode](aqua/swapvm-opcode/) | A new programmable pricing instruction | Proven; includes official-router Extruction |
| Aqua Continuity | [aqua/continuity-recipe](aqua/continuity-recipe/) | Add pegged settlement to an existing app | Proven SDK pegged strategy |
| Uniswap stack: v4 hook | [uniswap/v4-hook](uniswap/v4-hook/) | Pool-specific directional fees and swap events | Proven |
| Uniswap stack: swap API | [uniswap/api-swap](uniswap/api-swap/) | A quote-and-swap interface | NOT PROVEN: API key unavailable |
| Uniswap stack: LP API | [uniswap/lp-api](uniswap/lp-api/) | Create or manage liquidity positions | NOT PROVEN: API key unavailable |
| Uniswap stack: v3/v2 pool | [uniswap/v3-or-v2](uniswap/v3-or-v2/) | A simple existing-pool swap | Proven |
| Uniswap stack: CCA | [uniswap/cca](uniswap/cca/) | A continuous token auction | Proven |
| Uniswap Continuity | [uniswap/continuity-recipe](uniswap/continuity-recipe/) | Add routed swaps to an existing product | Proven |
| ENSv2 new app | [ens/new-app-ensv2](ens/new-app-ensv2/) | Names, scoped subnames, and app configuration | Proven on Sepolia fork |
| ENSv2 existing app / Continuity | [ens/add-to-existing](ens/add-to-existing/) | Replace address-only configuration with ENS records | Proven on Sepolia fork |
| World MiniKit component | [world/minikit-app](world/minikit-app/) | An authenticated mini app inside World App | NOT PROVEN; credentials/human steps |
| World ID component | [world/world-id-verify](world/world-id-verify/) | A unique-human gate for an on-chain action | NOT PROVEN; credentials/human steps |
| World AgentKit component | [world/agentkit](world/agentkit/) | A human-registered agent using a protected resource | NOT PROVEN; credentials/human steps |
| World Continuity recipe | [world/continuity-recipe](world/continuity-recipe/) | Add human verification to an existing app | NOT PROVEN; credentials/human steps |
| Sui payments | [sui/payments](sui/payments/) | Stablecoin checkout with sponsored gas | Proven official USDC and sponsored gas |
| Sui DeFi | [sui/defi](sui/defi/) | An escrow with approved release and timed refund | Proven approved claim and expired refund |
| MultiBaas basics | [curvegrid/multibaas-basics](curvegrid/multibaas-basics/) | Contract deployment and read/write through an API | NOT PROVEN: MultiBaas credentials unavailable |
| MultiBaas events/webhooks | [curvegrid/events-webhooks](curvegrid/events-webhooks/) | React to indexed contract events in a backend | NOT PROVEN: service credentials and HTTPS callback |

Components do not imply separate sponsor prize pools. Follow the current
published card when selecting an award and disclose the reused starter.

Public, MIT-licensed starter kit published 2026-09-14 JST; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency). All seven kit folders were public by **2026-09-14 10:05:04 JST**, revision [`dc49e72`](https://github.com/ss251/tokyo-kits/tree/dc49e728ec8eb35b33b61002605874fcba88218d). Each kit's `PRIOR-ART.md` retains its earlier first-public timestamp.
