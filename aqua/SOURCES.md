# Aqua integration sources

Checked 2026-09-14. These are official primary sources. The kit's transaction receipts live separately under `receipts/`; the read checks below are not fill receipts.

## Exact package and source pins

| Component | Pin | Official source |
| --- | --- | --- |
| TypeScript SwapVM SDK | `@1inch/swap-vm-sdk@0.4.4` | [npm metadata](https://registry.npmjs.org/@1inch%2fswap-vm-sdk/latest), [source](https://github.com/1inch/sdks/tree/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm) |
| TypeScript Aqua SDK | `@1inch/aqua-sdk@0.3.4` | [npm metadata](https://registry.npmjs.org/@1inch%2faqua-sdk/latest), [source](https://github.com/1inch/sdks/tree/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/aqua) |
| Solidity SwapVM source, current deployment release | `v1.0.2`, `32c687c2b73101fc26549e48fa1ff8a4d73afbac` | [official tag](https://github.com/1inch/swap-vm/tree/v1.0.2), [source](https://github.com/1inch/swap-vm/tree/32c687c2b73101fc26549e48fa1ff8a4d73afbac) |
| Solidity Aqua source used by the SDK's integration fixture | `af53fc31b636c683a6b72cf4755f5aad089c12e8` | [SDK dependency manifest](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/package.json), [source](https://github.com/1inch/aqua/tree/af53fc31b636c683a6b72cf4755f5aad089c12e8) |

The SDK packages above were npm `latest` on the check date. The SwapVM Solidity release preserves all 34 opcodes in the current SDK's Aqua table. The SDK's own integration fixture still pins older `be0a9cc840bb63b9f1abf864a39f4393e1a7312e`, which contains only the first 33 opcodes and lacks `onlyTxOriginTokenBalanceNonZero` at byte index 33. Do not append a custom opcode at that occupied SDK index. The Aqua revision is the SDK's explicit integration pin. These are pinned source references, not claims of byte-for-byte deployment reproduction. Current SwapVM HEAD has reorganized `src/` into `contracts/` and changed instruction internals. Import the pinned interfaces; execute against the official deployment.

## Official deployments

- Aqua registry: `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`.
- AquaSwapVMRouter: `0x111111338c5091e8440b67b168bae16a668ac0de`.
- [Aqua deployment statement](https://github.com/1inch/aqua#deployments), [pinned SDK router address map](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm-contract/constants.ts), [pinned SDK Aqua address map](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/aqua/src/aqua-protocol-contract/constants.ts).

Read-only RPC checks on 2026-09-14:

| Fork source | Endpoint | Head observed after calls | Router runtime bytes | `AQUA()` | `eip712Domain()` |
| --- | --- | --- | --- | --- | --- |
| Polygon, 137 | `https://polygon-bor-rpc.publicnode.com` | `93755476` | `20541` | Official registry above | Name `1inch SwapVM v1.0`, version `1.0.2`, chain `137`, official router |
| Base, 8453 | `https://mainnet.base.org` | `51274449` | `20541` | Official registry above | Name `1inch SwapVM v1.0`, version `1.0.2`, chain `8453`, official router |

The endpoint head numbers were sampled after the independent calls and are not a single pinned state proof. A demo should choose one fork block and include it in its receipt. The current SDK maps 17 networks; the original brief's 13-chain count is older context. This kit deliberately supports Polygon and Base only.

## Minimal official-router flow

1. Give maker tokens and native gas on a local fork. Keep fork funding/state changes explicit in the receipt.
2. Maker approves both tokens to the official Aqua registry. Taker approves its input token to the official SwapVM router.
3. Build `AquaPeggedAmmStrategy.new(...)` using each token's actual decimals and reserve in atomic units. `MakerTraits.default()` selects Aqua authentication.
4. Send `AquaProtocolContract.ship({ app: officialRouter, strategy: order.encode(), amountsAndTokens })`. This records virtual balances; ship should not change maker token custody.
5. Call `SwapVMContract.quote(...)` from the taker address. For the exact equality proof, send `swap(...)` with the quoted output as `TakerTraits.threshold` and `strictThreshold: true`.
6. Verify receipt success, the `Swapped` event, maker/taker ERC20 balance changes, and Aqua virtual balance changes. Then dock `order.hash()` with all shipped tokens.

Primary implementations: [SDK end-to-end examples](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/tests/swap-vm.spec.ts), [pegged strategy](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/strategies/aqua-pegged-amm-strategy.ts), [settlement and approvals](https://github.com/1inch/swap-vm/blob/be0a9cc840bb63b9f1abf864a39f4393e1a7312e/src/SwapVM.sol).

## Encoding and integration gotchas

- The official [swap-vm-template deployment](https://github.com/1inch/swap-vm-template#deployment) deploys a fresh Aqua registry and router. Its tests are useful examples; those replacement deployments do not prove an integration with the official registry/router.
- The SDK's own end-to-end fixture also deploys a test registry/router. Copy the call flow, then substitute and check official addresses.
- [`Order.hash()`](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/order.ts) uses `keccak256(order.encode())` in Aqua mode. No signature or EIP-712 domain is required in that mode.
- The current order parser is `Order.decode(new HexString(encoded))`; some README snippets still say `Order.parse`.
- Use `AquaProgramBuilder` for official-router strategies. Its instruction table is distinct from generic SwapVM. The table's comments are one-based labels, while the encoded byte is the zero-based array index: Extruction is byte `0x20` in the SDK's Aqua table, and `onlyTxOriginTokenBalanceNonZero` is byte `0x21`. The custom router example appends its own opcode at byte `0x22` and must be shipped to that custom app address while keeping the official registry. See the [v1.0.2 opcode table](https://github.com/1inch/swap-vm/blob/32c687c2b73101fc26549e48fa1ff8a4d73afbac/src/opcodes/AquaOpcodes.sol).
- Extruction instruction bytes are `[opcode:uint8][length:uint8][target:20 bytes][args:N bytes]`. Therefore external args have a maximum of 235 bytes. The kit uses 128-byte `abi.encode(token0, token1, numerator, denominator)` args. Source: [program encoder](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/programs/program-builder.ts), [Extruction argument encoder](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/instructions/extruction/extruction-args-coder.ts).
- [`IExtruction`](https://github.com/1inch/swap-vm/blob/be0a9cc840bb63b9f1abf864a39f4393e1a7312e/src/instructions/Extruction.sol) receives `(isStaticContext, nextPC, SwapQuery, SwapRegisters, args, takerData)` and returns `(nextPC, choppedLength, updatedRegisters)`. The kit consumes no taker data, preserves control flow, rounds exact-output input upward, and uses the same calculation in quote and swap modes. Repeating stateful external logic via backward jumps can break quote/swap consistency.
- Concentrated raw prices are in `tokenGt/tokenLt` atomic units scaled by `1e18`, where token ordering is numeric address order. A human price and token decimal ratio must both be included. Pegged builders normalize decimals and sort token reserves internally. Source: [strategy types](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/strategies/types.ts), [pegged argument normalization](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/src/swap-vm/instructions/pegged-swap/pegged-swap-args.ts).
- Aqua's `_safeCheckAquaPush` helper requires its per-strategy reentrancy lock; see [`AquaApp`](https://github.com/1inch/aqua/blob/af53fc31b636c683a6b72cf4755f5aad089c12e8/src/AquaApp.sol). The custom callback must authenticate the app and bind maker, strategy, token, and amount to the active swap.
- SwapVM SDK and Aqua SDK use different exact `@1inch/sdk-core` dependency versions (`0.1.6` and `0.1.5`). Construct `Address`/`HexString` using each SDK's re-exports at that SDK's boundary rather than forcing incompatible nominal types.

## Licensing

This starter's original files are MIT. Imported sponsor SDKs and Solidity sources retain their own licenses: `LicenseRef-Degensoft-SwapVM-1.1` and `LicenseRef-Degensoft-Aqua-Source-1.1`. They are not relicensed MIT by this repository. See the [SwapVM license](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/swap-vm/LICENSE) and [Aqua license](https://github.com/1inch/sdks/blob/635d0f10d0c8a2b7df5ca51538ece85a4950942d/typescript/aqua/LICENSE).
