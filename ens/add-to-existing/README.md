# Add ENSv2 to an existing app

This Continuity starter replaces literal application configuration with a validated ENSv2 profile. The recipient address, enabled flag, request limit, and display label feed the same app component before and after integration. It suits an existing app that needs owner-managed configuration or delegated namespaces without deploying a new app version for every change.

The example is generic. Tokyo's **Best Integration of ENSv2 into an Existing Project** category additionally requires an eligible existing project and its testnet deployment; this starter by itself is not evidence of an existing product or approved Continuity participation.

## Five-minute quickstart

From `ens/`:

```sh
cp .env.example .env
make install
make -C add-to-existing demo
make test
make dev
```

Open `http://localhost:3000`. In **Existing configuration**, enter a literal recipient and apply it. The baseline uses `enabled=true`, `limit=10`, and the label `Existing configuration`. Resolve your public ENSv2 Sepolia name in the adjacent panel. Switch **Literal / Resolved** to see the same application respond to the two configuration sources.

The recipient shown below the switch is the validated address used by the preview. The resolved label becomes the application heading. A false `app:enabled` or a request above `app:limit` disables the action. There is no mock resolution or hidden fallback if a record is missing.

## One-hour adaptation

| Time | Change | Evidence |
| --- | --- | --- |
| 0–10 min | Identify the existing recipient and configuration object. Preserve that shape as the app's input. | A visible literal baseline. |
| 10–25 min | Add the pinned viem adapter and official Sepolia Universal Resolver override. | An actual name resolves through the configured resolver. |
| 25–40 min | Add the required address and text records, optionally under a linked subname. | Executed write receipts and a recorded block snapshot. |
| 40–50 min | Pass validated ENS values into the existing app component. | Changing enabled/limit/recipient changes real app state. |
| 50–60 min | Demonstrate delegated record maintenance, negative permission checks, and the before/after behavior. | Reproducible receipts, current state, and a clear integration diff. |

Registration, Portal-free testnet funding, and public hosting must already be available for this estimate. The local demo uses an isolated fork so it does not require a production wallet key.

Minimal adapter boundary:

```ts
import { createEnsClient, readEnsConfig } from '../lib/ens'

const client = createEnsClient(process.env.ENS_RPC_URL)
const block = await client.getBlock()
const config = await readEnsConfig(client, name, { blockNumber: block.number })
// Pass config.recipient, config.enabled, config.limit, and config.label
// into the existing component that previously consumed literal values.
```

Use a server route as in [`app/api/resolve/route.ts`](../app/api/resolve/route.ts) when the RPC URL is private. The chain is Sepolia **11155111**; the adapter fixes the current official Universal Resolver, normalizes names, disables external CCIP fetches, and reads all fields at the same block.

## Record and permission boundary

Required values are the nonzero ETH address record, `app:enabled` (`true`/`false`), `app:limit` (integer 0–1000), and `app:label` (1–80 characters). These starter keys are an app convention, not a new ENS standard. Invalid values reject the configuration rather than silently using old defaults.

Delegated permissions belong to the registry/resolver, not the frontend. Discover the actual resolver and scope grants to the required operations. A subname must belong to a registry linked from its parent to resolve through the Universal Resolver. Keep a positive authorized write and a negative unauthorized write in the CLI evidence.

The browser action is an explicitly **local preview**. It does not send transactions or enforce on-chain access control. Do not treat an editable client-side flag as authorization for a protected server or contract operation; those systems must enforce their own checks against the resolved configuration and appropriate identity.

## Last proven

**PROVEN on a local Sepolia fork**, 2026-09-14 JST, source block **11699245**. Registration: `0x240a820a0330ad57fa42e6e8c98cb58550e57a1d50d21df83bc33d30703f99c4`. [Saved evidence](receipts/sepolia-latest.json) contains 13 successful transactions and 3 mined permission rejections, official code/source hashes, before/after configuration and fork provenance. Shared strict TypeScript,18 tests and production Next.js build pass.

Public live-demo URL: **not deployed**. A name created only on an ephemeral fork disappears when that fork stops. For live judging, configure a public Sepolia name, deploy the interface, and verify it against public state. A fork transaction hash is not a public explorer transaction. To inspect a retained local fork, set `ENS_RPC_URL` on the server to its loopback RPC; the interface displays the actual read block.

For the Continuity submission, show the existing testnet app, the literal behavior before integration, the changed records and resulting behavior after integration, the live-demo URL, and the exact disclosed starter commit. Confirm current ENS booth/demo instructions in person rather than assuming a past event's check-in requirement applies.

## Sources and prior art

viem **2.56.5**, Next **16.3.5**, and React **19.3.0** are pinned. The current official Universal Resolver is **`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`**, from ENS contracts source **`97a57293f3b4279d94b571e678edb53ce62638f4`**. See [`../addresses.json`](../addresses.json) and [`../SOURCES.md`](../SOURCES.md) for exact deployment and ABI provenance.

Official references: [application integration](https://docs.ens.domains/ensv2/tutorial-app-developers/), [current deployment table](https://docs.ens.domains/learn/deployments/), [Tokyo ENS criteria](https://ethglobal.com/events/tokyo2026/prizes/ens).

Original code is MIT licensed. Public prior-art publication is recorded in the parent disclosure. Disclose the reused commit, earlier project work, and the new event work separately; see [`../PRIOR-ART.md`](../PRIOR-ART.md).

Public, MIT-licensed starter kit published 2026-09-14; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency).
