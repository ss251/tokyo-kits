# Tokyo integration kits

Generic integration starters prepared before ETHGlobal Tokyo 2026. Original
starter code is MIT licensed; dependencies retain their own licenses.

Build order: Aqua → Uniswap → World → ENSv2 → Sui → Curvegrid → common.

| Kit | Status | Proof |
| --- | --- | --- |
| [Aqua](aqua/) | Proven on Polygon and Base | [4 executed paths](aqua/README.md#last-proven), 64 tests |
| [Uniswap](uniswap/) | Four components proven; API access blocked | [Base fork receipts](uniswap/README.md#coverage-and-last-proven), 57 tests |
| [World](world/) | Implemented; Portal/human/agent credentials blocked | 59 tests; [partial fork wiring](world/README.md#last-proven) |
| [ENSv2](ens/) | Both components proven | [Sepolia fork receipts](ens/README.md#last-proven),18 tests |
| [Sui](sui/) | Both components proven on public Testnet | [USDC + escrow receipts](sui/README.md#last-proven), 49 tests |
| [Curvegrid](curvegrid/) | Implemented; service credentials blocked | 60 tests; [partial fork receipt](curvegrid/README.md#last-proven) |
| Common | Queued | Not yet proven |

Each kit must pass its tests and execute a fork or testnet demo before it is
marked proven. Fork receipts are local evidence and cannot be found on a
public block explorer. Each kit's `PRIOR-ART.md` records publication separately
from execution. Existing templates must be disclosed when used at the event;
publication alone does not establish event eligibility.

Never commit credentials. Copy `.env.example` locally. Build/test commands
check uptime, wait when load exceeds 25, and share a machine-local lock.

Target: all kits proven and public by **Sep 18 JST**. Unproven components remain
explicitly marked and never delay publication of proven ones.

| Sponsor track / component | Subfolder | State |
| --- | --- | --- |
| Aqua open app | `aqua/app-open` | Proven |
| Aqua opcode extension | `aqua/swapvm-opcode` | Proven; includes official-router Extruction |
| Aqua Continuity | `aqua/continuity-recipe` | Proven SDK pegged strategy |
| Uniswap stack: v4 hook | `uniswap/v4-hook` | Proven |
| Uniswap stack: swap API | `uniswap/api-swap` | NOT PROVEN: API key unavailable |
| Uniswap stack: LP API | `uniswap/lp-api` | NOT PROVEN: API key unavailable |
| Uniswap stack: v3/v2 pool | `uniswap/v3-or-v2` | Proven |
| Uniswap stack: CCA | `uniswap/cca` | Proven |
| Uniswap Continuity | `uniswap/continuity-recipe` | Proven |
| ENSv2 new app | `ens/new-app-ensv2` | Proven on Sepolia fork |
| ENSv2 existing app / Continuity | `ens/add-to-existing` | Proven on Sepolia fork |
| World MiniKit component | `world/minikit-app` | NOT PROVEN; credentials/human steps |
| World ID component | `world/world-id-verify` | NOT PROVEN; credentials/human steps |
| World AgentKit component | `world/agentkit` | NOT PROVEN; credentials/human steps |
| World Continuity recipe | `world/continuity-recipe` | NOT PROVEN; credentials/human steps |
| Sui payments | `sui/payments` | Proven official USDC and sponsored gas |
| Sui DeFi | `sui/defi` | Proven approved claim and expired refund |
| MultiBaas basics | `curvegrid/multibaas-basics` | NOT PROVEN: MultiBaas credentials unavailable |
| MultiBaas events/webhooks | `curvegrid/events-webhooks` | NOT PROVEN: service credentials and HTTPS callback |

Components do not imply separate sponsor prize pools. Follow the current
published card when selecting an award and disclose the reused starter.
