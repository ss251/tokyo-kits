# Prior-art disclosure — common plumbing

- Name: Tokyo Kits — shared validation, fork, credential, and receipt plumbing.
- Intended public location: `https://github.com/ss251/tokyo-kits/tree/main/common`.
- Publication status: **PENDING**. Record the actual public push time and source commit after publication.
- Original code license: MIT; the repository and component license files record the full notice. Upstream tools and dependencies retain their licenses.
- Execution status: recorded separately in [README.md](README.md) and actual common receipts. Generic fork canaries are infrastructure evidence, not sponsor-integration proof.

This generic pre-existing component supplies sequential checks across the sponsor kits, local Polygon/Base/Sepolia fork startup, native-transfer canary receipts, receipt validation, environment/credential conventions, and a concise [AI-assisted build record](AI-USAGE.md). It contains no product-specific business logic or hackathon submission.

The canonical user specification is [KITS-BRIEF.md](../KITS-BRIEF.md). When reusing any part, disclose the exact public commit and files reused, identify work performed during the event, and include relevant specifications, prompts, and planning artifacts in the event repository. This summary does not replace the event team's own artifacts or establish eligibility.

Follow the [ETHGlobal rules](https://ethglobal.com/rules) and [Tokyo submission details](https://ethglobal.com/events/tokyo2026/info/details). Retain granular history and preserve **NOT PROVEN** labels for components without the required service or chain evidence.

| Publication record | Value |
| --- | --- |
| Confirmed public URL | PENDING |
| Published at, UTC and JST | PENDING |
| Source commit | PENDING |
| Common check receipt | [341 tests PASS](receipts/check-all-latest.json), 2026-09-14 |
| Three-chain infrastructure receipts | [Polygon](receipts/polygon-fork-latest.json), [Base](receipts/base-fork-latest.json), [Sepolia](receipts/sepolia-fork-latest.json); 2026-09-14, infrastructure only |
