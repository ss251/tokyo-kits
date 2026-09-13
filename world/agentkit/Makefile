.PHONY: demo test server
demo:
	cd .. && python3 scripts/serial.py bun scripts/demo.ts agentkit
test:
	$(MAKE) -C .. test
server:
	cd .. && bun agentkit/server.ts
