# Official sources and interface pins

This starter targets an actual Curvegrid MultiBaas deployment connected to Ethereum Sepolia. Official service access and authenticated callback delivery were **proven on 2026-09-17** against a hosted free-plan deployment; see the receipts linked from [README.md](README.md#last-proven). The generic counter and local fixtures do not replace those services.

## Pinned dependencies

| Component | Pin | Primary source |
| --- | --- | --- |
| MultiBaas TypeScript SDK | `@curvegrid/multibaas-sdk` **1.1.1** | [Official source revision `65f28a15e76f6e16feee7059301cb4fcf6b842d3`](https://github.com/curvegrid/multibaas-sdk-typescript/tree/65f28a15e76f6e16feee7059301cb4fcf6b842d3), [npm release](https://www.npmjs.com/package/@curvegrid/multibaas-sdk/v/1.1.1) |
| Local Ethereum signing and independent RPC checks | `viem` **2.56.5** | [Official viem documentation](https://viem.sh/docs/getting-started), installed package and `bun.lock` |
| Solidity compiler | **0.8.30**, Cancun EVM, optimizer 200, via IR | `foundry.toml`; original `src/KitCounter.sol` has an exact compiler pragma |
| TypeScript / Bun types | **7.0.2** / **1.4.2** | `package.json` and `bun.lock` |

`addresses.json` records the SDK revision, network, and independent RPC default. The generated counter address is recorded per run; there is no universal Curvegrid counter contract address. Dependencies are installed from their distributions, not copied into the source tree. [THIRD-PARTY.md](THIRD-PARTY.md) includes the complete pinned SDK MIT notice.

## Account, network, and permissions

- [First Steps](https://docs.curvegrid.com/multibaas/getting-started/account-and-deployment/) and [Curvegrid Console](https://console.curvegrid.com/): create an account and provision a deployment. Official docs describe a free plan without payment information. A deployment belongs to one blockchain; its network cannot be changed after creation.
- [Networks](https://docs.curvegrid.com/multibaas/networks/supported-networks/) and [official chain metadata](https://assets.multibaas.com/chains.json): select Ethereum Sepolia for this kit. The local signing policy requires chain ID **11155111**.
- [API Keys](https://docs.curvegrid.com/multibaas/api-keys/): API keys are user-scoped bearer credentials with selected group permissions. Record a newly created key privately; the UI does not show its secret afterward.
- [Users and roles](https://docs.curvegrid.com/multibaas/users-rbac/): administrative setup and runtime Blockchain API access have distinct roles. The docs' DApp User group is a starting point for runtime access, while setup needs permission to create/link contracts and configure webhooks.

MultiBaas administrative permissions are separate from Ethereum signing authority. This kit signs with a local Sepolia account and never treats an API response as authorization to send arbitrary calldata or value.

## SDK API contracts

The [pinned generated API source](https://github.com/curvegrid/multibaas-sdk-typescript/blob/65f28a15e76f6e16feee7059301cb4fcf6b842d3/api.ts) and its [endpoint documentation](https://github.com/curvegrid/multibaas-sdk-typescript/blob/65f28a15e76f6e16feee7059301cb4fcf6b842d3/README.md) define the callable interfaces. They use a deployment-specific `/api/v0` base and blockchain paths under `/chains/ethereum`. That path names the API family; the deployment's configured network determines the actual chain.

The current SDK methods do not accept the extra leading chain argument seen in older snippets. Its unsigned transaction schema also lacks a `chainId` field. The kit checks the deployment and an independent RPC against the local Sepolia pin, validates the expected unsigned intent, then explicitly sets the signing chain. It does not invent a remote `chainId` property or spread remote fields into a signature.

[`LinkAddressContractRequest`](https://github.com/curvegrid/multibaas-sdk-typescript/blob/65f28a15e76f6e16feee7059301cb4fcf6b842d3/docs/LinkAddressContractRequest.md) defines `startingBlock` as a string. Omitting it disables event indexing. The starter links from the actual deployment receipt block, preserving the first increment event; it does not use an obsolete `start` field or assume a linked ABI alone enables synchronization.

The [event-indexing guide](https://docs.curvegrid.com/multibaas/event-indexing/) describes MultiBaas event queries. An event row or a successful HTTP response alone cannot establish the kit's proof: the runner must reconcile the indexed result with the independently retrieved Ethereum receipt and exact `Incremented(address,uint256)` log.

## Webhook wire format and local policy

The [official webhook specification](https://docs.curvegrid.com/multibaas/webhooks/) defines JSON-array envelopes, `event.emitted`, `X-MultiBaas-Signature`, and `X-MultiBaas-Timestamp`. Its HMAC-SHA256 message is the unmodified HTTP body followed by the decimal timestamp bytes, with no separator. Re-serializing parsed JSON before verification changes the signed message.

The consumer's five-minute timestamp tolerance, body/batch bounds, fixed event/contract scope, and SQLite deduplication are kit policy. They are not asserted as server guarantees. The callback contains no chain-ID field; private configuration binds it to the deployment and network already verified by the runner. The full demo separately matches accepted delivery data against the actual transaction receipt.

Keep an externally delivered, authenticated callback distinct from a locally generated HMAC test request. The latter proves only the consumer fixture. No live MultiBaas webhook delivery is claimed without the former.
