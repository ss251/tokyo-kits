# Credentials and prerequisites by kit

Copy a kit's own `.env.example` to an ignored `.env` in that kit. The names below match those examples; this document is a reference, not a shared secrets file. RPC configuration, public identifiers, private API credentials, and human verification are different prerequisites.

At the current handoff, **11 of 19 components have complete receipts**. The remaining eight are two Uniswap API components, four World components, and two Curvegrid components. Missing prerequisites stay **NOT PROVEN** even when local tests pass. The [top-level coverage table](../README.md) and component READMEs hold the current execution status.

## Aqua, Uniswap contract paths, and ENSv2

These fork paths require no sponsor API key or production wallet key. Public RPC defaults are provided. A private archive-RPC endpoint may help with rate limits or replaying an old block, but its access token belongs only in the ignored kit environment.

| Kit | Exact variables | Purpose |
| --- | --- | --- |
| [Aqua](../aqua/.env.example) | `POLYGON_RPC_URL`, `BASE_RPC_URL`, `FORK_CHAIN`, optional `FORK_BLOCK_NUMBER` | Choose Polygon/Base and a reproducible fork block |
| [Uniswap](../uniswap/.env.example) | `BASE_RPC_URL`, optional `FORK_BLOCK_NUMBER` | v4 hook, v3 interaction, CCA, and Continuity fork execution |
| [ENSv2](../ens/.env.example) | `ENS_RPC_URL`, optional `FORK_BLOCK_NUMBER`, optional `ENS_DEMO_NAME` | Sepolia fork and frontend name configuration |

Fork demos create or impersonate accounts only inside their controlled local chain. They do not need a Mainnet private key. A name registered only on an ENS fork resolves only through that retained fork; setting `ENS_DEMO_NAME` does not publish it to Sepolia.

## Common fork RPC configuration

The shared launcher reads `POLYGON_RPC_URL`, `BASE_RPC_URL`, `SEPOLIA_RPC_URL`, and the compatible `ENS_RPC_URL` fallback from ignored `common/.env`. A nonempty `SEPOLIA_RPC_URL` takes precedence over `ENS_RPC_URL`; exported environment values are never overwritten by the file. Copy [common's example](.env.example) for public defaults. No signing key is required. See the [launcher instructions](README.md#environment-and-private-state) for URL rules and replay settings.

## Uniswap API access — two blocked components

Obtain credentials through the [official Uniswap Developer Platform](https://developers.uniswap.org/dashboard). Follow the [swap integration guide](https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide) and [LP integration guide](https://developers.uniswap.org/docs/liquidity/liquidity-provisioning-api/integration-guide) for the relevant entitlement.

| Variable | Access or input |
| --- | --- |
| `UNISWAP_API_KEY` | Private trading API credential for `/quote` and `/swap` |
| `UNISWAP_LP_API_KEY` | Private LP API credential; the client falls back to `UNISWAP_API_KEY` if that key has LP access |
| `UNISWAP_LP_POSITION_ID` | Optional public Base WETH/USDC V3 NFT ID for the existing-position scenario |

Swap and LP access may require different entitlements. Successful key creation alone is not proof that both products accept the credential. LP management additionally needs an independently verified public-chain NFT; a fork-created NFT cannot be discovered by the public API. Its owner is impersonated only on the local fork. No production signing key is required for these demos.

## World Portal and human verification — four blocked components

Use the [official World Developer Portal](https://developer.world.org). Mini Apps and World ID can have different app IDs. Follow the [MiniKit setup](../world/minikit-app/README.md), [World ID service](../world/world-id-verify/README.md), and [AgentKit guide](../world/agentkit/README.md); server keys must never become `NEXT_PUBLIC_*` values.

| Exact variable | Kind and required setup |
| --- | --- |
| `WORLD_APP_ORIGIN` | Public configuration: exact browser/World App HTTPS origin; loopback HTTP works only for local development |
| `WORLD_MINIKIT_APP_ID` | Public Mini App ID from the Portal |
| `WORLD_ID_APP_ID` | Public World ID app ID from the Portal |
| `WORLD_RP_ID` | Public registered RP identifier, hexadecimal `rp_` form |
| `WORLD_RP_SIGNING_KEY` | Private RP signing key, server only |
| `WORLD_ID_ACTION` | Fixed registered uniqueness action; example `tokyo-kits-verify` |
| `WORLD_ID_ENVIRONMENT` | Matching Portal environment; example `staging` |
| `WORLD_ID_TTL_SECONDS` | Challenge policy, default `300` |
| `WORLD_ID_DATABASE`, `WORLD_WALLET_DATABASE` | Persistent ignored SQLite files for verification and wallet sessions |
| `WORLD_CHAIN_RPC_URL` | Public World Chain RPC, chain **480** |
| `FORK_BLOCK_NUMBER` | Optional reproducible World Chain fork block |
| `WORLD_PING_ADDRESS` | Public World Chain deployment used by the actual Mini App; a fork-only address cannot be called by World App |
| `WORLD_PING_ALLOWLIST_CONFIRMED` | Set `true` only after adding that target in the Portal |
| `WORLD_PROOF_FILE` | Private fresh authentic World ID proof, default `.run/world-id-private-proof.json` |
| `WORLD_AGENT_PRIVATE_KEY` | Private signing key for an agent already registered to a human through official AgentBook |

Both current v4 on-chain verifier environments use World Chain **480**. The legacy World Chain Sepolia verifier is not ABI-compatible with the v4 proof path. An authentic proof and a real World App session cannot be replaced by gas funding, a Portal key, or a positive mocked verifier test.

For AgentKit registration, use the pinned official CLI and complete the World App human step:

```sh
bunx @worldcoin/agentkit-cli@0.2.0 register 0xYourAgentAddress
bunx @worldcoin/agentkit-cli@0.2.0 status 0xYourAgentAddress
```

The live agent key must control that registered address. [Official AgentKit integration docs](https://docs.world.org/agents/agent-kit/integrate) describe the registry-backed flow. The standalone AgentKit server has additional optional controls documented in its README: `WORLD_RPC_URL`, `WORLD_AGENTKIT_ORIGIN`, `WORLD_AGENTKIT_PORT`, and `WORLD_AGENTKIT_DB`. These are separate from the root World `.env.example`; use `WORLD_CHAIN_RPC_URL` for the shared World runner.

## Sui — two public-testnet components proven

No gateway key or production wallet is needed. `SUI_GRPC_URL` defaults to the public Testnet gRPC endpoint. The runner generates payer, recipient, and sponsor keys in ignored `sui/.run/accounts.json`, enforces file mode `0600`, and never reads or changes the global Sui keystore.

From `sui/`, print only their public addresses:

```sh
python3 scripts/serial.py bun scripts/demo.ts accounts
```

Fund the payer with official **USDC on Sui Testnet** through the [Circle faucet](https://faucet.circle.com). The payment consumes one USDC; the observed setup obtained 20 USDC without a human CAPTCHA. Keep the same local accounts for the retry. The exact official coin type is pinned in [Sui addresses](../sui/addresses.json) and verified against [Circle's deployment list](https://developers.circle.com/stablecoins/usdc-contract-addresses).

The SDK requests native SUI for payer and sponsor through the official faucet. If that API is rate-limited, submit both addresses to the [official SUI browser faucet](https://faucet.sui.io), selecting Testnet. No wallet connection or account was needed in the observed browser flow; its normal proof-of-work wait succeeded while the API was blocked. Faucet conditions can change. These funding steps do not themselves prove a payment or escrow; the successful scenario receipts in [Sui's README](../sui/README.md#last-proven) do.

## Curvegrid — two blocked components

Create an account and a **Sepolia** MultiBaas deployment through the [official Curvegrid Console](https://console.curvegrid.com/). The [first-steps guide](https://docs.curvegrid.com/multibaas/getting-started/account-and-deployment/) describes free-plan provisioning. The deployment is bound to a fixed network.

| Exact variable | Required access or configuration |
| --- | --- |
| `MULTIBAAS_URL` | HTTPS deployment origin, without `/api/v0`, query, credentials, or fragment |
| `MULTIBAAS_ADMIN_API_KEY` | Private setup key for contract upload/deployment/linking and webhook configuration |
| `MULTIBAAS_API_KEY` | Separate private runtime key with Blockchain API access; DApp User is the documented starting group |
| `CURVEGRID_RPC_URL` | Independent Sepolia RPC for chain and receipt checks |
| `CURVEGRID_PRIVATE_KEY` | Optional Sepolia-only local signer; otherwise the runner generates an ignored `.run/` signer |
| `CHAIN_ID` | Optional pin; must equal `11155111` |
| `MULTIBAAS_WEBHOOK_URL` | Public HTTPS callback ending exactly in `/webhook`, forwarded to the demo consumer |
| `MULTIBAAS_WEBHOOK_CONFIG` | Optional standalone private config path; default `.run/webhook-config.json` |

Use [API-key setup](https://docs.curvegrid.com/multibaas/api-keys/) and [role documentation](https://docs.curvegrid.com/multibaas/users-rbac/) to configure the two keys. Fund the generated signer with Sepolia test ETH; MultiBaas permissions do not grant signing authority or gas. A Curvegrid Testnet public Web3 key is not the required Sepolia deployment API key.

The events demo manages its own local consumer and creates an ephemeral webhook. Prepare external HTTPS forwarding before running it. It deletes that webhook on cleanup; the retained private config is a record, not an active subscription. Ongoing standalone use needs a separately registered active webhook and its actual secret/ID.

Standalone receiver alternatives from the kit's example are `CONTRACT_ADDRESS`, `MULTIBAAS_WEBHOOK_SECRET`, `MULTIBAAS_DEPLOYMENT_ID`, and `MULTIBAAS_WEBHOOK_ID`, together with `CHAIN_ID`. `WEBHOOK_HOST` and `WEBHOOK_PORT` are optional. The callback secret is generated by MultiBaas and stays in private config, not public receipts. See the [complete Curvegrid instructions](../curvegrid/README.md).

## Storage and disclosure boundary

Keep keys, private proofs, signing state, API tokens, and SQLite files in ignored local paths. Public receipts may contain addresses, transaction hashes, executed calldata, contract events, sanitized request IDs, and source hashes. They must not contain raw private account files or reusable authorization material.

Supplying one missing credential does not resolve other human, entitlement, funding, or public-callback requirements. Record the resulting actual receipt before changing a component from **NOT PROVEN** to proven.
