# Prior-art disclosure — Sui starter

- Name: Tokyo Kits — Sui DeFi & Payments integration starter.
- Public location: `https://github.com/ss251/tokyo-kits/tree/main/sui`.
- Publication status: **PUBLIC**, 2026-09-14T00:26:25Z (Sep 14 09:26:25 JST); first complete revision `34d34b4d8255673b282cb3659b91b2631bc70d31`.
- Original code license: [MIT](LICENSE). Dependencies retain their licenses in [THIRD-PARTY.md](THIRD-PARTY.md).
- Live integration status: **Both components proven on public Sui Testnet**; see the component READMEs and receipt files. The strict TypeScript check, 20 Bun tests, and 29 Move tests pass.

This pre-existing generic template contains two Move modules: a typed coin payment with an immutable receipt, and a shared escrow with depositor approval, recipient claim before expiry, depositor refund at/after expiry, and immutable settlement receipts. Its TypeScript runner uses the pinned official Sui SDK, gRPC, testnet publication, generated local test accounts, gas sponsorship, official Circle testnet USDC payments, native-SUI escrow scenarios, and receipt validation. It includes unit fixtures, setup scripts, dependency pins, and integration documentation.

It contains no hackathon product, exchange integration, zkLogin flow, yield strategy, or application-specific policy beyond the generic payment/escrow conditions. Test fixtures and pending scenarios must not be represented as successful public-chain integrations.

When reusing this starter in an ETHGlobal submission, disclose the exact public repository path and commit used, describe which files and capabilities already existed, and distinguish work performed during the event. Include the relevant specification, prompts, and planning artifacts with the submitted repository. Publication alone does not establish eligibility; disclose pre-existing work to the ETHGlobal team and in the written submission, following the [event rules](https://ethglobal.com/rules) and [Tokyo details](https://ethglobal.com/events/tokyo2026/info/details).

Verified publication record:

| Field | Value |
| --- | --- |
| Public URL | https://github.com/ss251/tokyo-kits/tree/main/sui |
| Published at (UTC and JST) | 2026-09-14T00:26:25Z (Sep 14 09:26:25 JST) |
| Source commit | `34d34b4d8255673b282cb3659b91b2631bc70d31` |
| Proven components and receipt links | [Sponsored USDC](payments/receipts/testnet-latest.json), [escrow claim/refund](defi/receipts/testnet-latest.json) |

Public, MIT-licensed starter kit published 2026-09-14; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency).
