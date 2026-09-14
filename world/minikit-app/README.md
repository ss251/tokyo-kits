# MiniKit app

**NOT PROVEN end to end.** The Next.js integration lab is implemented, but no authenticated Developer Portal configuration, real World App session, or live MiniKit transaction receipt was available during construction. `make demo` exits nonzero with this blocker. A local fork ping does not establish MiniKit transport, wallet authentication, or human verification.

This generic starter connects three independent operations: MiniKit wallet authentication, IDKit v4 human verification, and a zero-value `WorldPing.ping(bytes32)` call. It is suitable for an existing app that needs wallet control and a human check before exposing an action. It contains no product policy or token transfer.

## Five-minute local start

From `world/`, with Node 24+, Bun, Foundry, and Python available:

```sh
cp .env.example .env
make install
make dev
```

Open `http://localhost:3000`. Missing configuration is visible, and dependent buttons remain disabled. `make test` runs the shared checks. Build and test commands use the repository's serial build wrapper; do not start parallel compiler processes.

The local UI can be inspected immediately. Completing the live flow also requires the Portal and human steps below. A browser wallet can sign the World ID wallet-binding challenge outside World App; this does not exercise MiniKit's `walletAuth` command.

## Developer Portal setup

1. Open the [World Developer Portal](https://developer.world.org) and select or create a Mini App. Set its URL to the exact HTTPS address that World App will open. Put its public ID in `WORLD_MINIKIT_APP_ID`.
2. Select or create the World ID application and its action. Set `WORLD_ID_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, and `WORLD_ID_ACTION` on the server. Mini Apps and World ID can have separate app IDs. Match `WORLD_ID_ENVIRONMENT` to the Portal environment; the example uses `staging`.
3. Set `WORLD_APP_ORIGIN` to that exact origin, with no trailing slash or path, and restart the server. A development tunnel changes this setting. The origin must match both the browser request and the signed wallet message.
4. Deploy the unchanged [`WorldPing`](../src/WorldPing.sol) contract on public World Chain, chain ID **480**, using a developer-controlled wallet. Record its deployment receipt. Add this target to the Mini App's permitted contracts in the Portal, set `WORLD_PING_ADDRESS`, and set `WORLD_PING_ALLOWLIST_CONFIRMED=true`. A contract deployed only on Anvil cannot be called by World App.
5. Open the configured Mini App inside World App. Approve **Authenticate in World App**, **Verify with World ID**, then **Send zero-value ping**. World App must be compatible with MiniKit 2 and IDKit 4.

**Portal screenshots are missing:** an authenticated Portal session was unavailable. The instructions above describe the required settings without inventing screenshots or UI labels. Capture redacted screenshots of the app URL, public app/action IDs, environment, and allowed contract when completing setup; never capture the RP signing key.

World's final Tokyo prize categories were not published when this component was prepared. MiniKit, World ID, AgentKit, and Continuity are coverage components, pending the official category announcement.

## Request and receipt flow

```mermaid
sequenceDiagram
    participant App as Next.js / World App
    participant Server as Same-origin API + SQLite
    participant World as Official World services
    participant Chain as World Chain 480
    App->>Server: Request one-time wallet nonce
    App->>App: MiniKit.walletAuth
    App->>Server: Signed SIWE message
    Server->>Chain: Verify wallet signature
    Server-->>App: HttpOnly wallet session
    App->>Server: Request wallet-bound World ID challenge
    App->>App: Sign challenge + IDKit explicit constraints
    App->>Server: Wallet signature + v4 proof
    Server->>World: Verify proof with configured RP
    Server-->>App: Consume challenge/nullifier; human session
    App->>Server: Prepare zero-value ping
    App->>App: MiniKit.sendTransaction
    App->>Server: User operation hash
    Server->>World: Resolve operation to transaction hash
    Server->>Chain: Check successful receipt + matching Ping event
    Server-->>App: Confirmed transaction receipt
```

The server checks SIWE domain, URI origin, chain, nonce, request ID, statement, address, and time bounds. `viem.verifyMessage` verifies EOA and ERC-1271/ERC-6492 smart-wallet signatures on World Chain. A single SQLite transaction consumes the nonce and creates the session. Cookies are HttpOnly, SameSite Strict, and Secure on HTTPS. State-changing routes require the configured Origin; JSON bodies are bounded.

IDKit uses an explicit `proof_of_human` constraint with the wallet's **raw 20 bytes**, a challenge expiry constraint, and `genesis_issued_at_min=0`. Legacy proofs are disabled. The server verifies the wallet signature, strict v4 response scope, and official proof response before atomically consuming the challenge and nullifier. Human sessions are scoped to environment, RP, action, app, and origin; changing configuration invalidates their human authorization. See [World ID verification](../world-id-verify/README.md) for verifier details.

The ping preparation route requires a verified human session. **The ping contract itself is public and does not enforce identity.** Use [`WorldIDGate`](../src/WorldIDGate.sol) when the contract must enforce the proof. The ping demonstrates MiniKit transaction transport with zero native value and no token approvals.

## Last proven

Live World App flow: **NOT PROVEN — no live transaction receipt.** Required evidence is a successful World Chain receipt containing `Ping(sender, note)` at the configured contract, matching the authenticated wallet and server-issued random note. The UI displays a Worldscan link only after those checks pass.

MiniKit's `userOpHash` means **submitted**, not executed. The server resolves it through the same public endpoint used by the pinned MiniKit React SDK, then independently checks the chain receipt. This SDK lookup currently needs no API key. Lookup failure or a pending receipt remains unconfirmed, with a manual retry button.

`make -C .. probe` records isolated fork infrastructure evidence separately in [`world/infrastructure/receipts/worldchain-latest.json`](../infrastructure/receipts/worldchain-latest.json). It cannot complete this component. To close the live blocker, retain the real transaction hash and add its timestamp, target, sender, and environment here. Do not publish wallet signatures, identity proofs, session cookies, or private keys.

## Implementation and gotchas

- UI: [`app/world-lab.tsx`](../app/world-lab.tsx); route adapters: [`app/api`](../app/api); server session logic: [`app/_server/wallet-auth.ts`](../app/_server/wallet-auth.ts).
- Run Next.js on Node 24+ for `node:sqlite`. SQLite files live in ignored `.run/`, with private filesystem permissions. For multiple server instances, use a shared transactional store before deployment; independent SQLite files cannot enforce global replay protection.
- Keep server secrets out of `NEXT_PUBLIC_*`. Public configuration exposes only app IDs, environment, origin, and target address. Config and databases initialize lazily, so missing Portal credentials do not prevent a build.
- Human verification consumes the action's nullifier. A repeated attempt with the same identity/action is rejected. Use a new explicitly configured action for a separate test, preserving the real replay behavior.
- **Download private proof** is optional and user-triggered. Move the exported JSON to `.run/world-id-private-proof.json` for the on-chain gate demo and use it before expiry. No proof is logged or stored in browser local storage.
- Staging and production World ID v4 on-chain verification use World Chain **480**. The legacy Sepolia verifier is incompatible; no sandbox on-chain proof is claimed.

Exact pins: Next **16.3.5**, React **19.3.0**, `@worldcoin/minikit-js` and `@worldcoin/minikit-react` **2.0.3**, `@worldcoin/idkit` **4.2.3**, IDKit Core **4.2.4**, IDKit Server **1.1.1**, viem **2.56.5**. See the shared lockfile for the full dependency graph.

Official sources: [IDKit in Mini Apps](https://docs.world.org/world-id/idkit/mini-apps), [wallet authentication](https://docs.world.org/mini-apps/commands/wallet-auth), [message signing](https://docs.world.org/mini-apps/commands/sign-message), [transaction submission](https://docs.world.org/mini-apps/commands/send-transaction).

Public, MIT-licensed starter kit published 2026-09-14 JST; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency). The first complete public revision is `53a149e6a190c781f733e349f8df53638190314e`, pushed **2026-09-14 08:40:21 JST** (`2026-09-13T23:40:21Z`); see [`PRIOR-ART.md`](../PRIOR-ART.md). Publication does not change this component's NOT PROVEN status.
