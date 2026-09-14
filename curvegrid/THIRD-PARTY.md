# Third-party licenses

Original Tokyo Kits contracts, integration code, tests, scripts, and documentation are licensed under [MIT](LICENSE), copyright 2026 Tokyo Kits contributors. Upstream dependencies retain their own notices.

| Dependency | Pin | License |
| --- | --- | --- |
| `@curvegrid/multibaas-sdk` | **1.1.1**, official source `65f28a15e76f6e16feee7059301cb4fcf6b842d3` | MIT; full upstream notice below |
| `viem` | **2.56.5** | MIT; retain the installed package's license |
| `typescript` | **7.0.2** | Apache-2.0 |
| `@types/bun` | **1.4.2** | MIT |

`package.json` pins direct versions and `bun.lock` records resolved transitive packages and integrity values. SDK code and dependencies are installed through the package manager, not vendored into the kit. Foundry and the Solidity compiler are external tools. `KitCounter.sol` and its tests import no third-party Solidity code.

MultiBaas is an external Curvegrid service. Its account, deployment, and API terms are separate from the open-source SDK license. This independent starter does not claim Curvegrid or ETHGlobal endorsement.

## MultiBaas SDK notice

Verbatim from the [official pinned SDK LICENSE](https://github.com/curvegrid/multibaas-sdk-typescript/blob/65f28a15e76f6e16feee7059301cb4fcf6b842d3/LICENSE):

```text
MIT License

Copyright (c) 2023 Curvegrid Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
