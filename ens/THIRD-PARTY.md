# Third-party notices

Original Tokyo Kits code is MIT, as stated in [`LICENSE`](./LICENSE).

- **ENSv2 Solidity source and deployment ABI artifacts:** [ensdomains/contracts-v2](https://github.com/ensdomains/contracts-v2/tree/97a57293f3b4279d94b571e678edb53ce62638f4), commit `97a57293f3b4279d94b571e678edb53ce62638f4`. The referenced Solidity files declare `SPDX-License-Identifier: MIT`. The ABI arrays in `abi/` are extracted from that revision's official deployment JSONs. Attribution and immutable source links appear in `addresses.json` and `SOURCES.md`.
- **Verifiable Factory:** [ensdomains/verifiable-factory](https://github.com/ensdomains/verifiable-factory), MIT Solidity source. The demo calls ENS's deployed factory; it does not substitute a newly deployed factory.
- **viem:** [wevm/viem](https://github.com/wevm/viem), version `2.56.5`, MIT. Its ENS helpers perform normalization, namehash/labelhash and DNS encoding; retain the package's bundled dependency notices.
- **ENSjs:** [ensdomains/ensjs](https://github.com/ensdomains/ensjs), stable `4.3.1`, MIT, is a documented compatible alternative; it is not required by this adapter.

Third-party package licenses remain in installed dependencies. This starter's MIT license does not replace or relicense those dependencies. Source/ABI integrity hashes establish which artifacts were used; they are not a security audit or endorsement by ENS.

## ENS deployment artifact license

The following notice is retained from the pinned [ENS contracts-v2 LICENSE](https://github.com/ensdomains/contracts-v2/blob/97a57293f3b4279d94b571e678edb53ce62638f4/LICENSE) for the vendored ABI artifacts.

```text
MIT License

Copyright (c) 2024 ENS Labs Limited

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
