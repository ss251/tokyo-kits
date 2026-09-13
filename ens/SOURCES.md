# ENSv2 source and compatibility record

Checked **2026-09-14**. This starter targets the current official Sepolia ENSv2 beta, chain **11155111**. Original starter code and the referenced ENS Solidity sources are MIT; retain the dependency licenses. See [`THIRD-PARTY.md`](./THIRD-PARTY.md).

## Current deployment supersedes the earlier preview

The current [official deployment page](https://docs.ens.domains/learn/deployments/) links its Sepolia ABI artifacts to `ensdomains/contracts-v2` commit **`97a57293f3b4279d94b571e678edb53ce62638f4`**. The [official overview](https://docs.ens.domains/ensv2/overview/) is now available on the production documentation domain.

Earlier research used an official-linked preview table at `aecceff3.docs-bao.pages.dev`, which listed an older deployment and required Universal Resolver override `0xd26f2040d083af1cd2962ba303f4bea0c4faf142`. That table is obsolete for this kit. The current Sepolia deployment uses **`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`**, and the kit explicitly selects it. Never mix the old preview registrar/registry/resolver addresses with the new deployment.

[`addresses.json`](./addresses.json) contains all addresses used by this kit, the source commit, full deployment JSON SHA-256 hashes, and extracted ABI SHA-256 hashes. [`abi/`](./abi/) contains ABI arrays extracted from those exact deployment files. For example, the [official ETHRegistrar artifact](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/deployments/sepolia/ETHRegistrar.json) supplies both its address and ABI; the interface is not copied from a generic tutorial.

| Contract | Current Sepolia address |
| --- | --- |
| ETHRegistrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| ETHRegistry | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| RootRegistry | `0x8115186e8f2e0b0281e86ab91f0f48ba90364354` |
| VerifiableFactory | `0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef` |
| PermissionedResolverImpl | `0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e` |
| UserRegistryImpl | `0x624a25d67b59d587752ebec8dded8827dae52050` |
| MockUSDC | `0x768f42455a2d082e23ceef7d51e5787c82d67a39` |
| StandardRentPriceOracle | `0x8914b66260eb8c4fff795650c3ae8cd335958987` |
| UpgradableUniversalResolverProxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| UniversalResolverV2 implementation | `0x4a1817d13e9cf196f471725176355c1234b63c70` |

The public RPC `https://ethereum-sepolia.publicnode.com` returned chain 11155111 and nonempty code for the registrar, ETH/root registries, factory, resolver implementation, user-registry implementation, test USDC and Universal Resolver. The observed block was `0xb283b2`; exact byte sizes are in the manifest. Individual requests with `User-Agent: tokyo-kits/0.1` worked; a batch request returned HTTP 403. These reads prove code existence only. Actual fork receipts must establish registration, writes and resolution separately.

## Reproducing the ABI artifacts

```sh
# Offline integrity check of the vendored ABI arrays:
python3 scripts/fetch-abis.py --check

# Re-fetch the pinned official deployment JSONs and reproduce ABI arrays:
python3 scripts/fetch-abis.py
```

The download path is fixed to the official repository and pinned commit. Each full response must match its recorded hash and address before its ABI is extracted; the extracted bytes must then match the ABI hash. Changing a manifest pin is a reviewed source update, not an automatic update to a moving branch. The script performs no contract deployment, install, build or signing.

## Library versions and read policy

npm registry checks returned viem **`2.56.5`** and stable ENSjs **`4.3.1`**. ENSjs also publishes `5.0.0-alpha.1` and `5.0.0-sepolia-fix.1`; stable read compatibility does not imply stable v2 write helpers. `@ensdomains/contracts-v2` returned npm 404. This starter uses pinned viem with exact deployment ABIs for writes, so an experimental ENSjs write API is unnecessary.

[`lib/ens.ts`](./lib/ens.ts) normalizes names using viem's ENSIP-15 normalizer, DNS-encodes them with its `packetToBytes`, and uses standard namehash/labelhash helpers. It intentionally accepts only `.eth` names/subnames, up to 1024 UTF-8 bytes overall and 255 bytes per normalized label. It rejects missing or malformed app configuration rather than supplying permissive defaults.

`createEnsClient()` sets **`ccipRead: false`**. The read adapter rejects clients without that policy. This keeps an arbitrary user-supplied name from causing HTTP requests to resolver-controlled URLs. This on-chain starter consequently does not support off-chain resolver records; supporting them requires an explicit gateway policy. Address/text/resolver reads use the same block number and the configured official Universal Resolver. The UI can obtain a block's number/hash/timestamp first and pass that number to the adapter. RPC reads remain dependent on the chosen provider; block anchoring does not itself attest provider honesty.

The concrete app fields are `app:enabled` (`true` or `false`), `app:limit` (canonical integer 0–1000), `app:label` (1–80 printable characters), and the ETH address record as recipient. Text values are data; they are never executed, rendered as HTML or fetched as URLs by this adapter. The UI's allowed action, limit and recipient derive from those records, rather than a decorative name label.

## Registration and hierarchy

The current [registrar guide](https://docs.ens.domains/ensv2/eth-registrar/) describes ERC20-paid commit/reveal registration. Query the deployed registrar's `MIN_COMMITMENT_AGE`, `MAX_COMMITMENT_AGE`, `MIN_REGISTER_DURATION`, `isAvailable`, `rentPriceOracle`, and `getRegisterPrice`; do not assume tutorial constants. The exact reveal inserts `paymentToken` immediately before `referrer`, while `makeCommitment` excludes the payment token. Both include the chosen owner, resolver, subregistry and duration.

The officially deployed [test ERC20 source](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/test/mocks/MockERC20.sol) exposes unrestricted `mint(address,uint256)`. It is a test asset, not Circle-issued mainnet USDC. A fork can mint this official token, approve the official registrar, and pay a real registration charge without synthetic ERC20 storage edits.

Deploy the user's resolver and subregistry through the official factory using the pinned implementations. `PermissionedResolver.initialize(admin,roles,bytes[] setters)` can initialize records atomically; `UserRegistry.initialize(rootAccount,roles)` grants initial registry permissions. The factory emits `ProxyDeployed` and exposes `verifyContract(proxy)` to establish that a proxy belongs to that factory and identify its implementation. The [factory architecture](https://docs.ens.domains/ensv2/verifiable-factory/) explains caller-bound CREATE2 salts; sending the deployment from another account changes the derived address.

A newly deployed subregistry must be linked from the parent with `setSubregistry(currentTokenId,registry)`. Its parent pointer can be set with `setParent(parentRegistry,parentLabel)`. A child token in an unlinked registry is not an ENS-resolvable subname. Fetch the current token ID before a write; v2 token IDs can change. These details are described in the [contract developer guide](https://docs.ens.domains/ensv2/tutorial-contract-developers/) and [mutable-token guide](https://docs.ens.domains/ensv2/mutable-token-ids/).

## Scoped permissions

Current resolver setters retain `setAddr(bytes32 node,address)` and `setText(bytes32 node,string key,string value)`. Delegation uses **`authorizeTextRoles(bytes dnsName,string key,address delegate,bool grant)`**. The permissioned resolver deliberately disables inherited generic `grantRoles` / `revokeRoles`; those entry points always revert. Use the resolver's name/record authorization helpers. See the [pinned resolver implementation](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/src/resolver/PermissionedResolver.sol).

The [registry roles](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/contracts/src/registry/libraries/RegistryRolesLib.sol) use one bit per four-bit slot, with admin variants shifted by 128 bits. `ALL_ROLES` is `0x1111…1111`, not the all-ones uint256 mask. The full-role initialization is appropriate for the demo owner; a delegate receives only one text-key permission. Test authorized `app:limit` updates, rejected `app:enabled` / address writes, and rejected updates after revocation. Permissions granted to another account do not necessarily disappear when a name token transfers.

## Track and evidence boundaries

The current [Tokyo ENS prize page](https://ethglobal.com/events/tokyo2026/prizes/ens) names an ENSv2 open track and an existing-project Continuity track, requires Sepolia ENSv2, meaningful application dependence, public source and a working live-demo URL. Both examples share the same official-contract adapter; the existing-project recipe shows a bounded replacement of literal configuration with ENS-resolved configuration.

A successful local fork run proves the chain integration against the recorded Sepolia state, not a new public Sepolia name or an externally reachable application. A public live demo using newly registered names needs public Sepolia transactions and a reachable hosting/RPC setup. Keep local fork, public testnet and hosted-UI evidence separate. No successful registration is claimed by this source record alone.
