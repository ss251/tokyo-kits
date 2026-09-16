# Prior-art disclosure — Curvegrid starter

- Name: Tokyo Kits — Curvegrid MultiBaas integration starter.
- Public location: `https://github.com/ss251/tokyo-kits/tree/main/curvegrid`.
- Publication: **PUBLIC**; verified timestamp and source revision below.
- Original code license: [MIT](LICENSE). The upstream SDK and other dependencies retain their notices in [THIRD-PARTY.md](THIRD-PARTY.md).
- MultiBaas execution status: **PROVEN on 2026-09-17 JST** against a hosted Sepolia deployment; receipts under `multibaas-basics/receipts/` and `events-webhooks/receipts/`. Generic counter tests, local signing tests, synthetic webhook requests, and fork transactions do not establish that proof and remain labeled partial.

This generic pre-existing template contains an owner-only Solidity counter, contract tests, a pinned official MultiBaas SDK adapter, contract upload/deployment/linking and read/write scenarios, local transaction-intent validation, independent chain-receipt checks, indexed-event reconciliation, and an HMAC-authenticated webhook consumer with durable deduplication. It also contains setup scripts, dependency pins, unit fixtures, and documentation. There is no hackathon product or product-specific business logic.

For event reuse, disclose this exact public repository path and the source commit used, list the capabilities and files that predated the event, and identify new work performed during the event. Include relevant specifications, prompts, and planning artifacts with the submission. Retain granular history. Follow the [ETHGlobal rules](https://ethglobal.com/rules) and [Tokyo submission details](https://ethglobal.com/events/tokyo2026/info/details); a publication timestamp alone does not establish eligibility.

| Publication record | Value |
| --- | --- |
| Confirmed public URL | https://github.com/ss251/tokyo-kits/tree/main/curvegrid |
| Published at, UTC and JST | 2026-09-14T00:45:31Z / Sep14 09:45:31 JST |
| Source commit | `e37e0644fcece6691705236f7ec573344b96be86` |
| MultiBaas basics receipt | PROVEN 2026-09-17 — `multibaas-basics/receipts/sepolia-latest.json` |
| Authenticated webhook receipt | PROVEN 2026-09-17 — `events-webhooks/receipts/sepolia-latest.json` |

Any separate counter-only fork receipt must remain labeled as partial local-contract evidence when these records are completed.


## Verified public publication

Public, MIT-licensed starter kit published 2026-09-14; used as a disclosed library per ETHGlobal Tokyo rules (info/details: starter kits allowed with transparency).

Public URL: https://github.com/ss251/tokyo-kits/tree/main/curvegrid . First complete public revision `e37e0644fcece6691705236f7ec573344b96be86`; GitHub pushed_at 2026-09-14T00:45:31Z (Sep14 09:45:31 JST). At that revision the two MultiBaas components were implemented and tested locally with credential preflights explicitly NOT PROVEN; they were proven on 2026-09-17 JST. The counter-only fork receipt is partial evidence.
