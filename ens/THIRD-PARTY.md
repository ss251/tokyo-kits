# Third-party notices

Original Tokyo Kits code is MIT, as stated in [`LICENSE`](./LICENSE).

- **ENSv2 Solidity source and deployment ABI artifacts:** [ensdomains/contracts-v2](https://github.com/ensdomains/contracts-v2/tree/97a57293f3b4279d94b571e678edb53ce62638f4), commit `97a57293f3b4279d94b571e678edb53ce62638f4`. The referenced Solidity files declare `SPDX-License-Identifier: MIT`. The ABI arrays in `abi/` are extracted from that revision's official deployment JSONs. Attribution and immutable source links appear in `addresses.json` and `SOURCES.md`.
- **Verifiable Factory:** [ensdomains/verifiable-factory](https://github.com/ensdomains/verifiable-factory), MIT Solidity source. The demo calls ENS's deployed factory; it does not substitute a newly deployed factory.
- **viem:** [wevm/viem](https://github.com/wevm/viem), version `2.56.5`, MIT. Its ENS helpers perform normalization, namehash/labelhash and DNS encoding; retain the package's bundled dependency notices.
- **ENSjs:** [ensdomains/ensjs](https://github.com/ensdomains/ensjs), stable `4.3.1`, MIT, is a documented compatible alternative; it is not required by this adapter.

Third-party package licenses remain in installed dependencies. This starter's MIT license does not replace or relicense those dependencies. Source/ABI integrity hashes establish which artifacts were used; they are not a security audit or endorsement by ENS.
