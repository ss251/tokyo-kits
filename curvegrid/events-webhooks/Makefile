.PHONY: demo test serve
demo:
	cd .. && python3 scripts/serial.py bun scripts/demo.ts events-webhooks
test:
	cd .. && python3 scripts/serial.py bun scripts/check.ts
serve:
	cd .. && bun events-webhooks/server.ts
