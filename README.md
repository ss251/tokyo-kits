# Tokyo integration kits

Generic integration starters prepared before ETHGlobal Tokyo 2026. Original
starter code is MIT licensed; dependencies retain their own licenses.

Build order: Aqua → Uniswap → World → ENSv2 → Sui → Curvegrid → common.

| Kit | Status | Proof |
| --- | --- | --- |
| [Aqua](aqua/) | Building: official-registry fork integration | Not yet proven |
| Uniswap | Queued | Not yet proven |
| World | Queued | Not yet proven |
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
