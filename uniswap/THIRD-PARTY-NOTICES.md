# Third-party notices

The MIT license in this directory applies to the original Tokyo Kits integration code. It does not replace upstream dependency licenses, copyright notices, SPDX identifiers, or hosted-service terms. Dependencies are restored from [bun.lock](bun.lock) and [solidity-dependencies.json](solidity-dependencies.json); their source and license files stay in the installed packages/archives. Preserve those files when redistributing upstream source or compiled artifacts.

This inventory was checked against the installed package metadata, license files, and Solidity SPDX headers on **2026-09-14**. File-specific notices take precedence over a coarse package-level label. The table identifies direct dependencies and the contract dependencies relevant to these examples; the lockfile is the full transitive package inventory.

| Upstream work | Pinned version / revision | License notices |
| --- | --- | --- |
| Uniswap V4 Core | `1.0.2`, `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` | [BUSL-1.1](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/licenses/BUSL_LICENSE) for `PoolManager.sol` and other marked files; [MIT](https://github.com/Uniswap/v4-core/blob/59d3ecf53afa9264a16bba0e38f4c5d2231f80bc/licenses/MIT_LICENSE) for marked interfaces/types/libraries, including the interfaces imported by this hook |
| Uniswap V4 Periphery | `1.0.3` | [MIT](https://github.com/Uniswap/v4-periphery/blob/60cd93803ac2b7fa65fd6cd351fd5fd4cc8c9db5/LICENSE), with individual source notices retained |
| OpenZeppelin Uniswap Hooks | `1.1.1` | [MIT](https://github.com/OpenZeppelin/uniswap-hooks/blob/bd5287c4a9f5c22c2393f7587a9b357662916115/LICENSE) |
| OpenZeppelin Contracts | `5.6.1` | [MIT](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/LICENSE) |
| Uniswap V4 SDK / V3 SDK / SDK Core | `2.3.3` / `3.31.3` / `7.19.2` | MIT; original package license files and [SDK repository](https://github.com/Uniswap/sdks) notices retained |
| Uniswap Universal Router SDK / Permit2 SDK | `5.11.5` / `1.4.0` | MIT; original package license files retained |
| Uniswap Router SDK / V2 SDK, transitive | `2.11.4` / `4.21.3` | MIT; original package license files retained |
| Uniswap Universal Router source package, transitive | npm `2.1.0` | Installed `contracts/UniversalRouter.sol` specifies **GPL-3.0-or-later** and its `LICENSE` contains GPLv3. Its package metadata says `GPL-2.0-or-later`; preserve the source header and license text rather than treating it as MIT. [Official router source](https://github.com/Uniswap/universal-router) |
| Uniswap deployed Universal Router used by the demo | deployment/source `2.1.1` | [Official 2.1.1 source and license](https://github.com/Uniswap/universal-router/tree/999d561c3ad58fb5cab91b602911f3c75591a9c7). This deployed contract version is distinct from the transitive npm source package above |
| Uniswap Swap Router Contracts, transitive | `1.3.1` | Package declares GPL-2.0-or-later; [upstream notices](https://github.com/Uniswap/swap-router-contracts) retained |
| Uniswap V3 Core, transitive | `1.0.0` | Distributed package includes BUSL-1.1 text plus file-specific MIT/GPL notices; [upstream license files](https://github.com/Uniswap/v3-core) retained |
| Uniswap V3 Periphery, transitive | `1.4.4` | GPL-2.0-or-later package metadata and GPLv2 license text, plus file-specific notices; [upstream](https://github.com/Uniswap/v3-periphery) |
| Uniswap V2 Core, transitive | `1.0.1` | GPL-3.0-or-later; [upstream](https://github.com/Uniswap/v2-core) |
| Continuous Clearing Auction | `v2.1.0`, `7d7602d257733315434570f2a0c2f94f1c7b207a` | [MIT](https://github.com/Uniswap/continuous-clearing-auction/blob/7d7602d257733315434570f2a0c2f94f1c7b207a/LICENSE); the example calls the deployed official factory and records ABI/source provenance |
| Forge Standard Library | v1.11.0, `8e40513d678f392f398620b3ef2b418648b33e89` | [Apache-2.0 or MIT](https://github.com/foundry-rs/forge-std/tree/8e40513d678f392f398620b3ef2b418648b33e89), as declared upstream |
| Solmate | `4b47a19038b798b4a33d9749d25e570443520647` | [AGPL-3.0-only](https://github.com/transmissions11/solmate/blob/4b47a19038b798b4a33d9749d25e570443520647/LICENSE) package notice; retain individual Solidity SPDX identifiers |
| viem | `2.56.5` | [MIT](https://github.com/wevm/viem/blob/main/LICENSE) |
| TypeScript | `7.0.2` | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| Bun type definitions | `@types/bun` `1.4.2` | MIT package notice; retained with installed type definitions |

The local Solidity test fixture may compile and deploy official-source PoolManager code on a disposable test VM. The end-to-end demos interact with official deployed manager/router contracts on a local fork and do not publish replacement protocol deployments. The original hook imports official interfaces and helper libraries; it does not copy PoolManager's implementation into the starter's MIT source.

REST schema references and Uniswap documentation are cited in [SOURCES.md](SOURCES.md). The independently written clients retain those source pointers. No API credential, hosted service access, or upstream trademark rights are conveyed by the starter's license.
