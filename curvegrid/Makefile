.PHONY: install build test demo fork-demo
install:
	python3 scripts/serial.py bun install --frozen-lockfile
build:
	bun run build
test:
	bun run test
demo:
	bun run demo
fork-demo:
	python3 scripts/serial.py bun scripts/fork-demo.ts
