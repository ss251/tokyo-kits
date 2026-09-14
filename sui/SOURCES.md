# Official sources and reproduction pins

The code uses current official Sui interfaces pinned by the local dependency manifests. Package builds and unit tests succeeded with the pins below. Public-testnet demo receipts remain pending; these references establish provenance, not successful execution.

## Toolchain and dependencies

| Input | Pin and primary source | Local record |
| --- | --- | --- |
| Sui CLI | [Official testnet-v1.79.0 release](https://github.com/MystenLabs/sui/releases/tag/testnet-v1.79.0), [source commit `46f18562f1f5af2438d35828e8b62d5e0b972db7`](https://github.com/MystenLabs/sui/tree/46f18562f1f5af2438d35828e8b62d5e0b972db7) | `toolchain.json`; bootstrap also records installed executable SHA-256 in ignored `.run/tooling/installed.json` |
| macOS arm64 archive | `sui-testnet-v1.79.0-macos-arm64.tgz`, **381889716 bytes**, SHA-256 `79900034cb533832a3bf9f10d783c309bfa8259697d6417e6dccdb0758f0f613` | `scripts/bootstrap.py` checks both size and hash before extraction |
| TypeScript SDK | [`@mysten/sui` 2.31.0](https://www.npmjs.com/package/@mysten/sui/v/2.31.0); [official SDK repository](https://github.com/MystenLabs/ts-sdks/tree/main/packages/sui) | Exact direct version in `package.json`, resolved dependencies/integrities in `bun.lock` |
| Move framework and standard library | [Official revision `ae59d7718668b468ce65702ecb0440aa2330f389`](https://github.com/MystenLabs/sui/tree/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages) | Generated `move/Move.lock`, `pinned.testnet.Sui` and `pinned.testnet.MoveStdlib` |
| Language / environment | Move edition **2024**, `--build-env testnet` | `move/Move.toml`, build/test scripts |

The CLI release's source commit is **not** the framework dependency revision. The pinned CLI automatically resolved Sui and MoveStdlib to `ae59d771…` for the Testnet build environment; that exact result is committed in `Move.lock`. The [official package-management documentation](https://docs.sui.io/develop/manage-packages/move-package-management) explains implicit system dependencies and environment-specific lock entries. Do not replace the generated lock with a manually guessed dependency revision.

The observed public testnet node version in `toolchain.json` is `sui-node/1.79.0-a496bce0d1d6`. It is an observation of the remote node, not another local compiler pin. Public receipts record the service metadata actually returned during their own run.

## Move APIs

The original modules compose framework APIs rather than copying their implementations. Source reading began at the CLI release commit; compilation and tests use the lock-selected framework revision linked here.

| Framework source at the resolved revision | Role in this starter |
| --- | --- |
| [`coin.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/coin.move) and [`balance.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/balance.move) | Owned `Coin<T>`, shared-escrow `Balance<T>`, full settlement conversion |
| [`clock.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/clock.move) | Canonical Clock at `0x6`, millisecond deadline checks; test-only clock fixtures |
| [`transfer.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/transfer.move) and [`object.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/object.move) | Coin transfer, shared escrow, frozen receipts, UID deletion |
| [`tx_context.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/tx_context.move) | Sender identity remains distinct from gas sponsorship |
| [`test_scenario.move`](https://github.com/MystenLabs/sui/blob/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages/sui-framework/sources/test/test_scenario.move) | Unit inventories, sponsored contexts, object ownership and deletion assertions |

The unit suite uses framework test-only SUI minting and clock control. No token fixture is deployed as a replacement for official USDC, and test-clock changes are never used in the public demo.

## Network, assets, and SDK behavior

| Source | What it supports |
| --- | --- |
| [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), Sui Testnet row | Exact official type: `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` |
| [Circle faucet](https://faucet.circle.com) | Official testnet USDC funding; interactive controls may require a human |
| [Sui faucet documentation](https://docs.sui.io/getting-started/onboarding/get-coins) and [official browser faucet](https://faucet.sui.io) | Native SUI funding for test networks; the browser flow funded an address during setup while the SDK API was rate-limited |
| [Official gRPC SDK client](https://sdk.mystenlabs.com/sui/clients/grpc) | `SuiGrpcClient`, public endpoint configuration, typed reads and service calls |
| [SDK signing and execution](https://sdk.mystenlabs.com/sui/transactions/signing-and-execution) and [Sui sponsored transactions](https://docs.sui.io/develop/transaction-payment/sponsor-txn) | Sender/sponsor signatures over finalized transaction bytes and explicit gas ownership |
| [SDK JSON-RPC migration](https://sdk.mystenlabs.com/sui/migrations/sui-2.0/json-rpc-migration) and [network migration timeline](https://docs.sui.io/develop/accessing-data/json-rpc-migration) | gRPC replacement for deprecated JSON-RPC; public Mainnet shutdown occurred in July 2026, with later decommission stages still separately scheduled |

`addresses.json` records the observed Testnet genesis digest `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`, official framework `0x2`, Clock `0x6`, endpoint, and USDC type. The runner checks the live genesis response before execution. A locally chosen `network: 'testnet'` label alone is insufficient.

The receipt format records the actual package publication transaction, subsequent successful transactions, decoded object/event fields, balance effects, source-file hashes, lock files, compiler metadata, compiled-module hash, and any separate negative simulations. An address citation, package compilation, or simulated abort is never used as proof of successful public execution.
