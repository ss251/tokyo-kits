.PHONY: install build test demo dev probe
install:
	python3 scripts/serial.py bun install --frozen-lockfile
	python3 scripts/bootstrap.py
build:
	bun run build
test:
	bun run test
demo:
	bun run demo
dev:
	bun run dev
probe:
	python3 scripts/serial.py bun scripts/demo.ts probe
