# World ID 4: server verification and on-chain gate

**NOT PROVEN — a successful live World ID proof has not been supplied.** The server and gate can be tested without one, but test fixtures and official-verifier rejection receipts do not establish a successful human verification. This folder is provisional World technology coverage, not a confirmed Tokyo prize sub-track.

> PRIOR-ART — PUBLICATION PENDING: Release disclosure must record the actual publication date: “Public, MIT-licensed starter kit published <date>; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency).”

Original starter code is MIT; third-party code retains its own license. See [`../SOURCES.md`](../SOURCES.md) for exact pins, official addresses, protocol mapping and current blockers. The repository's public commit history supplies publication timestamp evidence once this code is pushed.

## Run and configure

From `world/`, run `make test` for the serialized checks and `make probe` for **PARTIAL infrastructure evidence** (including official verifier rejection). Run `make -C world-id-verify demo` with a private `WORLD_PROOF_FILE` for the authentic-proof fork path. Without that proof file the full World ID demo is blocked; the default all-subtrack `make demo` does not manufacture the missing identity prerequisites. The World ID tests use **Node 24's `node:sqlite`**, not Bun's SQLite implementation. The root runner transpiles the TypeScript Node tests and runs `node --test` under the shared load lock. Tests and probes generate no valid human proof.

The Next server lazily loads these variables from an ignored environment file:

| Variable | Purpose |
| --- | --- |
| `WORLD_ID_APP_ID` | World ID app ID from the Developer Portal; may differ from the MiniKit app ID |
| `WORLD_RP_ID` | RP ID, hexadecimal `rp_` identifier |
| `WORLD_RP_SIGNING_KEY` | Secret RP signing key, server only; never `NEXT_PUBLIC_*` |
| `WORLD_ID_ACTION` | Fixed uniqueness action; defaults to `tokyo-kits-verify` |
| `WORLD_ID_ENVIRONMENT` | `staging` by default; `production` and `sandbox` are explicit alternatives |
| `WORLD_APP_ORIGIN` | Exact HTTPS app origin, or loopback HTTP for local development |
| `WORLD_ID_TTL_SECONDS` | Signed challenge duration, 60–900 seconds; default 300 |
| `WORLD_ID_DATABASE` | Persistent SQLite file; default `.run/world-id.sqlite`, ignored by Git |
| `WORLD_CHAIN_RPC_URL` | World Chain 480 RPC used for wallet signature validation |

Keep SQLite on a persistent private volume for a deployed server; `.run/` is a development default. Deleting this database resets server replay protection. Do not use a fresh ephemeral database per request. The gate's on-chain nullifier mapping is independent.

## Route adapter contract

Server-only imports:

```ts
import { loadWorldIdConfig } from './server/config';
import { WorldIdStore } from './server/store';
import { createWorldIdService } from './server/verify';

const config = loadWorldIdConfig();
const store = new WorldIdStore(config.databasePath);
const service = createWorldIdService(config, store);
```

Create this service lazily once per server process. Never return `config` to the browser: it contains the RP signing key. Next route adapters use the Node runtime, enforce the configured Origin, accept bounded JSON bodies, and map `WorldIdError.status` / `.code` to generic public errors. Add deployment-level rate limiting before exposing public challenge creation; the store additionally caps each wallet at five active challenges.

`POST /api/world-id/challenge` with `{wallet}` returns `Challenge` from `server/challenge.ts`. It contains signed `rp_context`, fixed `app_id` / `action` / `environment`, `walletMessage`, the packed-address hex `signal`, and explicit credential constraints. The wallet signs **the exact returned `walletMessage`** using EIP-191. This binds the app origin, wallet, chain, RP, action, challenge nonce and expiry. The production verifier supports contract wallets via viem's World Chain `publicClient.verifyMessage`, including ERC-1271/ERC-6492 handling.

The IDKit client requests:

```ts
const request = await IDKit.request({
  app_id: challenge.app_id,
  action: challenge.action,
  environment: challenge.environment,
  rp_context: challenge.rp_context,
  allow_legacy_proofs: false,
}).constraints({
  type: 'proof_of_human',
  signal: hexToBytes(challenge.signal),
  expires_at_min: challenge.expiresAtMin,
  genesis_issued_at_min: challenge.genesisIssuedAtMin,
});
```

After IDKit completes, `POST /api/world-id/verify` with `{challengeId, walletSignature, result}`. Send `result` exactly as returned by IDKit. The server validates the fixed v4 uniqueness scope, one human credential with issuer schema 1, wallet signal, five proof words and exact requested expiry. It verifies wallet control, sends the unchanged result to the fixed official RP endpoint, then atomically consumes both the challenge and a canonical decimal nullifier scoped by environment/RP/action. Changing only the Portal app ID cannot reset this uniqueness policy. Concurrent requests can make only one successful claim. A rejected proof or unavailable upstream consumes neither value; expiry is checked again after network verification.

The default service has no HTTP or environment switch that accepts a fixture proof. Unit tests inject only the external transport/signature boundaries; that injection is not exposed by the app routes.

## Contract boundary and proof receipts

`../src/WorldIDGate.sol` calls the official World ID 4 verifier on World Chain 480. It fixes RP, action, human schema and genesis policy at deployment, derives the wallet signal from `msg.sender`, rejects stale expiry constraints, and consumes each nullifier once. The Solidity action and signal use `keccak256(bytes) >> 8`, matching the pinned SDK. A raw keccak action without the shift is incompatible despite the short mapping in the current prose guide.

The gate verifies the World proof directly. It does **not** require a server-issued challenge or a separate server attestation, and a successful server API response does not itself authorize an on-chain call. The same valid proof can be independently checked by the server and gate, each with its own replay state. A private export for a fork demo can contain `{wallet, rpId, action, result}`. Preserve the expiry window and keep real proof exports under ignored `.run/`; do not publish human proof payloads as generic test fixtures.

The full accepted-proof flow remains **NOT PROVEN** until a configured RP produces a valid proof, the official verification service accepts it, and the official verifier accepts an authenticated caller's proof on a fork or testnet with an actual receipt. Local fork impersonation can submit an already authentic proof for its bound wallet; it cannot establish real wallet-key ownership or manufacture the proof. Record those evidence boundaries separately.

The current v4 staging verifier is on mainnet chain 480. World Chain Sepolia 4801's documented router is legacy v3 and cannot verify the five-word v4 result. The separately gated `sandbox` mobile environment has no documented on-chain verifier address here.
