# Aqua / SwapVM starter

Status: in progress; no successful end-to-end execution claimed yet.

This kit integrates the official Aqua registry and AquaSwapVMRouter on a
Polygon fork, with Base as the alternate. Paths: SDK-built strategy (B), custom
callback app (A), and SwapVM external pricing instruction (C).

## Last proven

Not yet proven. A receipt will be added only after a successful local-fork
transaction and passing tests.

## Blockers

None confirmed yet. SDK/contract compatibility, RPC archive access and fork
execution are being checked.

## Official sources

- https://github.com/1inch/aqua
- https://github.com/1inch/swap-vm
- https://github.com/1inch/sdks

Do not use a starter's newly deployed Aqua registry as evidence of integration
with Tokyo's required official contracts. The demo must use the registry at
`0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` and router at
`0x111111338c5091e8440b67b168bae16a668ac0de`.
