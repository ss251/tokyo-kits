# AgentKit: a human-backed agent endpoint

**NOT PROVEN until a genuinely registered agent completes `make demo`.** Local acceptance tests use real EOA signatures and an explicitly mocked AgentBook lookup. They are not proof of human registration.

Use this for an existing agent API that needs a per-human allowance shared across all of that human's agents. The starter exchanges an official SDK challenge over HTTP, validates the agent signature, resolves its human ID through the official AgentBook, and grants three requests per human for `GET /data`. The parent demo then signs `AgentBookGate.record` on a World Chain fork with that same registered agent and writes a receipt. AgentBook state is never replaced or fabricated.

## Quickstart

From `world/`, install the pinned dependencies with `make install`. Register an agent wallet address with the official CLI and complete its World App human-verification flow:

```sh
bunx @worldcoin/agentkit-cli@0.2.0 register 0xYourAgentAddress
bunx @worldcoin/agentkit-cli@0.2.0 status 0xYourAgentAddress
```

Put `WORLD_AGENT_PRIVATE_KEY` in your local environment, using the registered agent's signing key. Do not commit it. `WORLD_RPC_URL` must resolve World Chain mainnet, chain **480**; its default AgentBook is `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`. AgentBook registration is a real prerequisite; fork gas funding cannot create it.

```sh
cd agentkit
make demo
make test
make server
```

The standalone service listens on `127.0.0.1:4021`. Configure `WORLD_AGENTKIT_ORIGIN` when placing it behind a reverse proxy, `WORLD_AGENTKIT_PORT` for another local port, and `WORLD_AGENTKIT_DB` for another persistent database path (default `world/.run/agentkit.sqlite` when launched through `make server`). Preserve that database across restarts to preserve quota and replay protection. The demo uses an isolated temporary SQLite file under `.run/` and deletes it after collecting its evidence.

## Integration boundary

`client.ts` wraps official `createAgentkitClient` and validates the returned challenge's exact requested URI, domain, resources, five-minute expiration and World Chain EOA policy before signing. It rejects HTTP redirects. `service.ts` uses official challenge enrichment, header parsing, message validation, signature verification and an injected `createAgentBookVerifier`. It additionally matches every issued challenge field and the entire current endpoint URI: the SDK's URI check alone compares only the host. `storage.ts` consumes a nonce and charges its human's endpoint quota in one SQLite `BEGIN IMMEDIATE` transaction. Separate agents registered to the same human share the same counter, including across service processes using the same local database. Invalid signatures do not burn a challenge; authenticated requests with exhausted quota do consume theirs.

This is a bounded World Chain EIP-191 EOA example. The SDK supports other chains and smart-wallet verification, which are outside this starter's accepted signature policy. Challenges last five minutes. Each request uses a new nonce. This example has no paid fallback: an exhausted free allowance returns HTTP 429, and `accepts` is empty. Add official x402 payment configuration separately if payment is part of the product.

Only the public agent address, human ID, SDK events, challenge digest and consumed outcome may enter proof receipts. The signing key and reusable authorization header are never included. See the parent README's Last proven section for the actual outcome; absence of registration remains a blocker, not a successful demonstration.

Official sources: [AgentKit integration](https://docs.world.org/agents/agent-kit/integrate), [AgentKit repository](https://github.com/worldcoin/agentkit). SDKs are pinned to `@worldcoin/agentkit@0.2.1` and `@worldcoin/agentkit-core@0.2.1` in the parent package and lockfile. Original starter code is MIT licensed.
