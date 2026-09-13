# Tokyo integration kits

Generic integration starters prepared before ETHGlobal Tokyo 2026. Original
starter code is MIT licensed; dependencies retain their own licenses.

Build order: Aqua → Uniswap → World → ENSv2 → Sui → Curvegrid → common.

| Kit | Status | Proof |
| --- | --- | --- |
| [Aqua](aqua/) | Proven on Polygon and Base | [4 executed paths](aqua/README.md#last-proven), 64 tests |
| [Uniswap](uniswap/) | Four components proven; API access blocked | [Base fork receipts](uniswap/README.md#coverage-and-last-proven), 57 tests |
| World | Building current MiniKit/IDKit/AgentKit examples | Not yet proven |
| ENSv2 | Queued | Not yet proven |
| Sui | Queued | Not yet proven |
| Curvegrid | Queued | Not yet proven |
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
| ENSv2 new app | `ens/new-app-ensv2` | Queued |
| ENSv2 existing app / Continuity | `ens/add-to-existing` | Queued |
| World MiniKit component | `world/minikit-app` | Queued; award details TBD |
| World ID component | `world/world-id-verify` | Queued; award details TBD |
| World AgentKit component | `world/agentkit` | Queued; award details TBD |
| World Continuity recipe | `world/continuity-recipe` | Queued; predicted track |
| Sui payments | `sui/payments` | Queued |
| Sui DeFi | `sui/defi` | Queued |
| MultiBaas basics | `curvegrid/multibaas-basics` | Queued; award details TBD |
| MultiBaas events/webhooks | `curvegrid/events-webhooks` | Queued; award details TBD |

Components do not imply separate sponsor prize pools. Follow the current
published card when selecting an award and disclose the reused starter.
