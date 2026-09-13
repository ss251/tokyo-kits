# Uniswap stack integration starters

Status: implementation in progress; no transaction proof claimed yet.

Components: `v4-hook/`, `api-swap/`, `lp-api/`, `v3-or-v2/`, `cca/`,
`continuity-recipe/`. They share pinned dependencies and one serialized fork
runner. Original code is MIT; third-party licenses remain in dependencies.

## Blockers

- Swap API and LP API credentials are absent from this task's environment and
  the relevant project configuration. Those paths remain **NOT PROVEN** until
  authenticated requests and returned transactions are executed successfully.
- On-chain fork paths are being implemented and tested independently.

## Last proven

Not yet proven.
