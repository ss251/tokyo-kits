.PHONY: install build test demo
install:
	python3 scripts/serial.py bun install --frozen-lockfile
	python3 scripts/serial.py python3 scripts/bootstrap.py
build:
	bun run build
test:
	bun run test
demo:
	bun run demo
