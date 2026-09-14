# Third-party code and licenses

Original Tokyo Kits Move modules, TypeScript integration code, tests, scripts, and documentation are licensed under the [MIT license](LICENSE), copyright 2026 Tokyo Kits contributors. The following upstream dependencies retain their own licenses; the kit's MIT license does not relicense them.

| Dependency | Pinned version or revision | License | Source / notice |
| --- | --- | --- | --- |
| Mysten Labs Sui TypeScript SDK | `@mysten/sui` **2.31.0** | Apache-2.0 | [Official npm package](https://www.npmjs.com/package/@mysten/sui/v/2.31.0), package `LICENSE` and `package.json` |
| Sui CLI | **testnet-v1.79.0**, source `46f18562f1f5af2438d35828e8b62d5e0b972db7` | Apache-2.0 for the Sui project; bundled dependencies retain their notices | [Pinned official source](https://github.com/MystenLabs/sui/tree/46f18562f1f5af2438d35828e8b62d5e0b972db7), [project license](https://github.com/MystenLabs/sui/blob/46f18562f1f5af2438d35828e8b62d5e0b972db7/LICENSE) |
| Sui Move framework and MoveStdlib | `ae59d7718668b468ce65702ecb0440aa2330f389` | Apache-2.0, as declared in the used source headers | [Resolved official framework source](https://github.com/MystenLabs/sui/tree/ae59d7718668b468ce65702ecb0440aa2330f389/crates/sui-framework/packages), generated `move/Move.lock` |
| TypeScript | **7.0.2** | Apache-2.0 | Installed `typescript/package.json` and license |
| Bun type declarations | `@types/bun` **1.4.2**, `bun-types` **1.4.2** | MIT | Installed package manifests and license files |

`bun.lock` records the complete resolved JavaScript dependency graph and integrity values. Transitive packages have their own license files in their distributions. Retain applicable license and notice files when redistributing those packages or the compiler. The official compiler is downloaded into ignored `.run/tooling/`; framework sources are fetched by package management, and `node_modules/` is ignored.

The original Move modules call upstream framework APIs for coins, balances, object ownership, events, transaction context, and Clock. The test suite uses upstream testing APIs. This repository does not include a copied framework implementation or a self-minted replacement for Circle USDC.

Circle's official token deployment, faucet, and documentation are external services and references, not MIT-licensed kit code. Sui, Mysten Labs, Circle, USDC, ETHGlobal, and their marks belong to their respective owners. This starter is an independent integration template and does not claim endorsement.

Exact compiler and dependency provenance is recorded in [SOURCES.md](SOURCES.md). Public reuse and event disclosure are described in [PRIOR-ART.md](PRIOR-ART.md).
