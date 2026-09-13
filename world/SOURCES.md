# World: source and compatibility record

Research date: **2026-09-14**. These four folders cover provisional World technology categories. Tokyo World prize sub-tracks remain unpublished; do not describe these as confirmed prize tracks. The kit deadline is Sep 18 JST, with unavailable integrations explicitly marked **NOT PROVEN**.

## Exact package pins

Versions below were read from npm's registry `/<package>/latest`, rather than inferred from documentation examples. Root `package.json` and lockfile are the installation authority.

| Package | Version | Source revision / compatibility |
| --- | --- | --- |
| `@worldcoin/minikit-js` | `2.0.3` | [Official tag source](https://github.com/worldcoin/minikit-js/tree/440f35ca0184e24e8d04886f4b45158bb1d0f345) |
| `@worldcoin/minikit-react` | `2.0.3` | Same source revision as MiniKit JS |
| `@worldcoin/idkit` | `4.2.3` | npm gitHead `b912d9c8439401263381fd065a2d67409ed739af`; depends on core `4.2.4` |
| `@worldcoin/idkit-core` | `4.2.4` | [Source](https://github.com/worldcoin/idkit/tree/a2326c6c3651cd838832d36042cfe388bc028754); depends on server `1.1.1` |
| `@worldcoin/idkit-server` | `1.1.1` | [Source](https://github.com/worldcoin/idkit/tree/92f9740af2c625b777a4d2d03c8acb52e14e5b16); server-only RP request signing |
| `@worldcoin/agentkit` | `0.2.1` | [Source](https://github.com/worldcoin/agentkit/tree/1ec70f7d321bc8dedfe2b6ceb347a8e7d39846ce) |
| `@worldcoin/agentkit-core` | `0.2.1` | Same source revision as AgentKit |
| `@worldcoin/agentkit-cli` | `0.2.0` | [Source](https://github.com/worldcoin/agentkit/tree/f87b798cd6a75d941f922e5e030c42f8ee866be0); internal IDKit core `2.1.0` dependency is intentional upstream compatibility, not an app dependency override |
| `@worldcoin/create-mini-app` | `0.4.1` | Official scaffold exists; this kit uses an explicit manual app and pinned packages |

The World application SDK packages above report MIT licenses. Preserve third-party notices and original licenses. The root also pins Next `16.3.5`, React/React DOM `19.3.0`, viem `2.56.5`, Hono `4.13.7`, and x402 core/evm/fetch/hono `2.25.0`. x402 packages are Apache-2.0, rather than MIT.

`@worldcoin/world-id-contracts@0.1.1` is an old legacy package. It is **not** a current World ID 4 contract distribution; use the official v4 deployment/interface below.

## Identity protocol and on-chain addresses

[Official on-chain verification guide](https://docs.world.org/world-id/idkit/onchain-verification) supplies the addresses and distinguishes legacy World ID 3 and World ID 4. [Network information](https://docs.world.org/world-chain/quick-start/info) supplies chain IDs and public RPC URLs. Exact addresses and read-only code checks are in [`addresses.json`](./addresses.json).

| Use | Chain | Contract |
| --- | --- | --- |
| World ID 4 production verifier | World Chain, 480 | `0x00000000009E00F9FE82CfeeBB4556686da094d7` |
| World ID 4 staging verifier | World Chain, 480 | `0x703a6316c975DEabF30b637c155edD53e24657DB` |
| Legacy World ID 3 router | World Chain, 480 | `0x17B354dD2595411ff79041f930e491A4Df39A278` |
| Legacy World ID 3 router | World Chain Sepolia, 4801 | `0x57f928158C3EE7CDad1e4D8642503c4D0201f611` |
| AgentBook | World Chain, 480 | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |

Both documented World ID 4 verifier environments are on **chain 480**. No World ID 4 Sepolia or sandbox verifier address was documented. Legacy Sepolia uses eight-word proofs; v4 uses five words. These are separate protocols, not interchangeable configuration values.

Read-only public RPC checks on Sep 14 confirmed chain IDs and nonempty code for every address above. The observed block numbers and byte sizes are in `addresses.json`. This establishes code existence, not successful human-proof verification.

## Exact hashing and proof mapping

The published `@worldcoin/idkit-server@1.1.1` package exports:

```ts
signRequest({ signingKeyHex, action, ttl })
// => { sig, nonce, createdAt, expiresAt }
```

Use server-configured action and RP; never sign an arbitrary client-supplied action. The RP signing key remains server-only. The signature commits to version, random field nonce, creation/expiry timestamps and the hashed action. The nonce is a 32-byte hex field element, not the illustrative UUID shown in parts of the guide. [`@worldcoin/idkit-core` integration](https://docs.world.org/world-id/idkit/integrate) describes forwarding the complete IDKit result unchanged to `POST https://developer.world.org/api/v4/verify/{rp_id}`.

The pinned server package's `hashToField` and core's [`hashing.ts`](https://github.com/worldcoin/idkit/blob/a2326c6c3651cd838832d36042cfe388bc028754/js/packages/core/src/lib/hashing.ts) use **`uint256(keccak256(bytes)) >> 8`**. Core `hashSignal` interprets valid `0x` strings as hex bytes. This kit passes the wallet's 20 bytes explicitly; Solidity reconstructs the same value from `abi.encodePacked(msg.sender)`.

**Documentation discrepancy:** the on-chain guide's short mapping says `action = keccak256(action)` without the eight-bit shift. The published SDK implementation hashes UTF-8 action bytes and shifts eight bits. This kit follows that pinned implementation. The protocol verifier receives an already hashed action and assigns it directly to the proof public input; it does not hash it again. See the official [`WorldIDVerifier.sol`](https://github.com/worldcoin/world-id-protocol/blob/31405df8bcd5a2784e04ad9890cf095111dcac13/contracts/src/WorldIDVerifier.sol). That historical protocol revision is referenced by the published signer and is used here for semantics, not represented as the deployed proxy's implementation revision.

RP IDs parse as hexadecimal `uint64`: strip `rp_`, then parse base 16. Canonical representation has 16 lowercase hex digits. See official [`rp.rs`](https://github.com/worldcoin/world-id-protocol/blob/31405df8bcd5a2784e04ad9890cf095111dcac13/crates/primitives/src/rp.rs). A v4 uniqueness result supplies nullifier, nonce, five proof words, schema and minimum expiry. It does not return the request's genesis constraint; the kit fixes that constraint to zero.

The published `CredentialRequestType` accepts a `Uint8Array` signal and explicit `expires_at_min` / `genesis_issued_at_min`. The `proofOfHuman` and `CredentialRequest` convenience helpers' options are typed more narrowly, so the UI uses a raw `.constraints({type:'proof_of_human', ...})` object. Legacy proofs are disabled. The server accepts exactly one `proof_of_human` response with issuer schema 1 and the exact requested expiry constraint.

`expires_at_min` is the minimum credential expiry proved by the circuit. The verifier rejects an old value according to its `_minExpirationThreshold`; the kit's gate uses the stricter `expiresAtMin >= block.timestamp` policy. The server requests expiry at its signed challenge deadline (default five minutes), checks that exact value, and rejects consumption at or after its deadline.

## MiniKit 2 behavior

[MiniKit v2 migration](https://docs.world.org/mini-apps/migration/minikit-v2) and [IDKit in mini apps](https://docs.world.org/world-id/idkit/mini-apps) supersede older examples: `MiniKit.verify` / `commandsAsync.verify` are removed. Use IDKit 4 and its native World App transport. Wallet authorization is not a proof of humanity.

[sendTransaction](https://docs.world.org/mini-apps/commands/send-transaction) uses encoded transactions. World App returns a **user operation hash**, including through its EIP-1193 `eth_sendTransaction` interface. Resolve it using the current MiniKit React receipt helper or the official user operation lookup, then verify the actual World Chain transaction receipt. A user operation hash must never be presented as a mined transaction hash.

[walletAuth](https://docs.world.org/mini-apps/commands/wallet-auth) uses a server-issued alphanumeric nonce, verified server-side with the expected domain, URI and expiry, consumed atomically. Current helpers live at `@worldcoin/minikit-js/siwe`. [Testing inside World App](https://docs.world.org/mini-apps/quick-start/testing) requires a Developer Portal app ID, phone-accessible HTTPS application, relevant contract/token allowlists and wallet interaction. An ordinary browser fallback or local fork transaction does not prove the native bridge.

## AgentKit 0.2

[Official integration](https://docs.world.org/agents/agent-kit/integrate) uses the x402 client and server hooks. The payment/signature chain can be Base, while registration and human lookup remain on **World Chain 480**. The SDK's [AgentBook verifier](https://github.com/worldcoin/agentkit/blob/1ec70f7d321bc8dedfe2b6ceb347a8e7d39846ce/core/src/agent-book.ts) reads the canonical address above; it catches RPC failures and returns `null`, so a demo must separately check RPC health and code before treating a null result as an unregistered agent.

The official [CLI registration source](https://github.com/worldcoin/agentkit/blob/f87b798cd6a75d941f922e5e030c42f8ee866be0/cli/src/index.ts) uses its built-in app `app_a7c3e2b6b83927251a0db5345bd7146a`, action `agentbook-registration`, and hosted relay `https://x402-worldchain.vercel.app`. A separate personal RP app is not required for this CLI flow, but an actual World App human verification is required. Registration binds the agent address and next nonce in the legacy proof signal. The on-chain [AgentBook contract](https://github.com/worldcoin/agentkit/blob/1ec70f7d321bc8dedfe2b6ceb347a8e7d39846ce/contracts/src/AgentBook.sol) verifies that proof using its configured router; the owner can change the router and group ID.

Without a valid human registration and control of the registered agent signer, only the genuine unregistered denial path and explicitly labelled middleware fixtures are runnable. Editing AgentBook storage, replacing its verifier, or impersonating an unrelated registered wallet does not prove human-bound agent control.

## Remaining live-flow dependencies

1. MiniKit native flow: Portal mini-app configuration, reachable HTTPS URL, allowlists, and World App approval.
2. World ID: registered app/RP/signing key and a real accepted proof. The [public simulator](https://docs.world.org/world-id/idkit/integrate) is described for `staging`; it still needs the app configuration. A fabricated proof is not a simulator proof.
3. [World ID sandbox access](https://docs.world.org/world-id/sandbox/sandbox-access) is a separate `sandbox` environment with Portal team enrollment and private mobile distribution approval. Do not confuse it with staging or infer an undocumented on-chain deployment.
4. AgentKit registration: built-in CLI app removes the personal Portal setup requirement, but not human verification and control of the agent key.

Missing these inputs leaves successful live identity / native transport **NOT PROVEN**. Server tests use explicit HTTP fixtures; contract tests use explicit verifier fixtures plus official fork rejection checks. The continuity recipe inherits the same live dependencies.
