# Uniswap developer feedback

Submit this file's public link through the required
[Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback).
This starter does not submit feedback on your behalf.

## Integration

- Event/project:
- Components and pinned versions:
- First successful transaction / time to integration:
- Relevant source files/lines:

## Reproducible friction

| Task | Observed problem | Reproduction | Workaround | Suggested improvement |
| --- | --- | --- | --- | --- |
| Universal Router 2.1.1 | Exact-input v4 tuple now includes minHopPriceX36; older examples omit it | Compare 2.1.1 router's periphery pin with old planner default | Explicit URVersion.V2_1_1 in v4-sdk planner | Version the snippets next to deployment addresses |
| Pool initialization | Current template and npm PositionManager interfaces disagree on initializePool argument count | Compare template script and periphery 1.0.3 interface | Use PoolManager.initialize directly | Pin examples to their dependency versions |

## Support / documentation

- Most useful documentation:
- Missing or contradictory documentation (URLs):
- Support used and result:
- Would continue building? Why:
- Form submission receipt/time: **not submitted**.
