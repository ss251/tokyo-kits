#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Managed, localhost-only Anvil forks. Never writes keys, mnemonics or chain state.

The default Anvil accounts contain synthetic local development balances. This
launcher does not fund an account or submit a transaction on a public network.
It deliberately holds no build lock: developers can build against a running node.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Iterator, TypedDict
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

CHAINS = {
    "polygon": (137, ("POLYGON_RPC_URL",), "https://polygon-bor-rpc.publicnode.com"),
    "base": (8453, ("BASE_RPC_URL",), "https://mainnet.base.org"),
    "sepolia": (11155111, ("SEPOLIA_RPC_URL", "ENS_RPC_URL"), "https://ethereum-sepolia.publicnode.com"),
}
STARTUP_SECONDS = 30.0
MAX_RESPONSE_BYTES = 2_000_000
RPC_ENV_NAMES = frozenset({"POLYGON_RPC_URL", "BASE_RPC_URL", "SEPOLIA_RPC_URL", "ENS_RPC_URL"})


class ForkError(RuntimeError):
    """A sanitized error that never includes a private upstream URL or RPC body."""


class ForkInterrupted(KeyboardInterrupt):
    def __init__(self, signum: int):
        self.signum = signum
        super().__init__("Fork interrupted")


class ForkInfo(TypedDict):
    rpc_url: str
    chain_id: int
    source_block: int
    source_hash: str


def resolve_chain(chain: str | int) -> tuple[str, int]:
    if isinstance(chain, bool):
        raise ForkError("Unsupported chain; choose polygon, base or sepolia")
    for name, (chain_id, _variables, _default) in CHAINS.items():
        if chain == name or chain == chain_id or chain == str(chain_id):
            return name, chain_id
    raise ForkError("Unsupported chain; choose polygon, base or sepolia")


def validate_rpc_url(value: str) -> str:
    if not isinstance(value, str) or not value or any(ord(char) <= 32 or ord(char) == 127 for char in value):
        raise ForkError("Invalid RPC URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if not parsed.hostname or parsed.username is not None or parsed.password is not None or "#" in value:
            raise ValueError()
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}):
            raise ValueError()
        if port is not None and not 1 <= port <= 65535:
            raise ValueError()
    except (ValueError, TypeError):
        raise ForkError("RPC URL must use HTTPS or loopback HTTP, without userinfo or fragments") from None
    return value  # Query/path API credentials remain private; this value is never printed.


def load_env_file(path: Path | None = None) -> None:
    """Read only known RPC settings; no shell, expansion, escapes, or environment overwrite."""
    source = path if path is not None else Path(__file__).resolve().parent / ".env"
    try:
        with source.open(encoding="utf-8") as stream:
            for line in stream:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                match = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)", stripped)
                if not match or match.group(1) not in RPC_ENV_NAMES:
                    continue  # Unrelated values are never parsed, copied, or reported.
                name = match.group(1)
                if stripped.startswith("export ") or not re.match(rf"^{name}\s*=", stripped):
                    raise ForkError(f"Unsupported .env syntax for {name}")
                value = stripped.split("=", 1)[1].strip()
                if value.startswith(("'", '"')):
                    quote = value[0]
                    end = value.find(quote, 1)
                    if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith("#")):
                        raise ForkError(f"Unsupported .env syntax for {name}")
                    value = value[1:end]
                else:
                    value = "" if value.startswith("#") else re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
                if any(character in value for character in ("$", "`", "\\", "'", '"')):
                    raise ForkError(f"Unsupported .env syntax for {name}")
                if value:
                    validate_rpc_url(value)
                if name not in os.environ:
                    os.environ[name] = value
    except FileNotFoundError:
        return
    except (OSError, UnicodeError):
        raise ForkError("Unable to read common RPC settings") from None


def upstream_url(name: str, override: str | None = None) -> str:
    if override is not None:
        return validate_rpc_url(override)
    load_env_file()
    _chain_id, variables, default = CHAINS[name]
    return validate_rpc_url(next((os.environ[key] for key in variables if os.environ.get(key)), default))


def _integer(value: object, label: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise ForkError(f"Invalid {label}")
    return value


def _quantity(value: object, label: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{1,64}", value):
        raise ForkError(f"Invalid RPC {label}")
    return int(value, 16)


def _block(value: object) -> tuple[int, str]:
    if not isinstance(value, dict):
        raise ForkError("RPC block was not available")
    number = _quantity(value.get("number"), "block number")
    block_hash = value.get("hash")
    if not isinstance(block_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", block_hash):
        raise ForkError("Invalid RPC block hash")
    return number, block_hash.lower()


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ForkError("RPC redirects are not permitted")


def _rpc(url: str, method: str, params: list[object], timeout: float = 5.0) -> object:
    request = Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                      headers={"Content-Type": "application/json", "User-Agent": "tokyo-kits/0.1"}, method="POST")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise ForkError("RPC response exceeded the size limit")
        payload = json.loads(body)
        if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0" or payload.get("id") != 1 or "error" in payload or "result" not in payload:
            raise ForkError("RPC returned an invalid or unsuccessful response")
        return payload["result"]
    except ForkError:
        raise
    except (URLError, OSError, ValueError, TimeoutError):
        raise ForkError("RPC request failed; verify the configured endpoint privately") from None


def _wait_for_load() -> None:
    try:
        uptime = subprocess.run(["uptime"], capture_output=True, text=True, timeout=5, check=False)
        if uptime.returncode == 0:
            print(uptime.stdout.strip(), file=sys.stderr, flush=True)
        while True:
            load = os.getloadavg()[0]
            if not math.isfinite(load):
                raise ForkError("Unable to determine machine load")
            if load <= 25:
                return
            print(f"Load {load:.2f} exceeds 25; waiting before starting Anvil.", file=sys.stderr, flush=True)
            time.sleep(10)
    except (AttributeError, OSError, subprocess.SubprocessError):
        raise ForkError("Unable to check uptime and machine load") from None


def _choose_port(port: int) -> int:
    _integer(port, "localhost port", 65535)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reserved:
        try:
            reserved.bind(("127.0.0.1", port))
        except OSError:
            raise ForkError("Requested localhost port is unavailable") from None
        return int(reserved.getsockname()[1])


def anvil_command(chain_id: int, port: int, block: int, rpc_url: str) -> list[str]:
    resolve_chain(chain_id)
    _integer(port, "localhost port", 65535)
    if port == 0:
        raise ForkError("Anvil command needs a resolved localhost port")
    _integer(block, "fork block", (1 << 64) - 1)
    return ["nice", "-n", "19", "anvil", "--host", "127.0.0.1", "--port", str(port), "--threads", "1",
            "--fork-url", validate_rpc_url(rpc_url), "--fork-block-number", str(block), "--chain-id", str(chain_id),
            "--fork-header", "User-Agent: tokyo-kits/0.1", "--timeout", "5000", "--retries", "1",
            "--no-storage-caching", "--silent"]


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        process.wait()
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


@contextmanager
def running_fork(chain: str | int, port: int = 0, block: int | None = None, rpc_url: str | None = None) -> Iterator[ForkInfo]:
    name, chain_id = resolve_chain(chain)
    _integer(port, "localhost port", 65535)
    if block is not None:
        _integer(block, "fork block", (1 << 64) - 1)
    upstream = upstream_url(name, rpc_url)
    old_handlers: dict[int, object] = {}
    process: subprocess.Popen[bytes] | None = None

    def interrupted(signum, _frame):
        raise ForkInterrupted(signum)

    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGINT, signal.SIGTERM):
            old_handlers[signum] = signal.signal(signum, interrupted)
    try:
        _wait_for_load()
        if _quantity(_rpc(upstream, "eth_chainId", []), "chain ID") != chain_id:
            raise ForkError("Upstream chain ID does not match the selected chain")
        source_block, source_hash = _block(_rpc(upstream, "eth_getBlockByNumber", [hex(block) if block is not None else "latest", False]))
        if block is not None and source_block != block:
            raise ForkError("Upstream returned a different block number")
        local_port = _choose_port(port)
        command = anvil_command(chain_id, local_port, source_block, upstream)
        try:
            process = subprocess.Popen(command, cwd=Path(__file__).resolve().parent, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        except OSError:
            raise ForkError("Unable to start Anvil; install the pinned Foundry toolchain") from None
        local_url = f"http://127.0.0.1:{local_port}"
        deadline = time.monotonic() + STARTUP_SECONDS
        while True:
            if process.poll() is not None:
                raise ForkError("Anvil exited before the fork was ready")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ForkError("Anvil startup exceeded 30 seconds")
            try:
                ready = _quantity(_rpc(local_url, "eth_chainId", [], timeout=min(1.0, remaining)), "local chain ID")
            except ForkError:
                time.sleep(min(0.25, max(0, deadline - time.monotonic())))
                continue
            if ready != chain_id:
                raise ForkError("Local fork chain ID mismatch")
            local_block, local_hash = _block(_rpc(local_url, "eth_getBlockByNumber", [hex(source_block), False], timeout=min(5.0, max(0.1, deadline - time.monotonic()))))
            if local_block != source_block or local_hash != source_hash:
                raise ForkError("Fork source block hash mismatch; retry after the upstream reorganization")
            if process.poll() is not None:
                raise ForkError("Anvil exited during startup verification")
            break
        yield {"rpc_url": local_url, "chain_id": chain_id, "source_block": source_block, "source_hash": source_hash}
    finally:
        # Avoid a second signal interrupting bounded cleanup and leaving a child behind.
        for signum in old_handlers:
            signal.signal(signum, signal.SIG_IGN)
        try:
            if process is not None:
                _stop(process)
        finally:
            for signum, handler in old_handlers.items():
                signal.signal(signum, handler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Managed localhost Anvil fork; accounts have synthetic local balances only.")
    parser.add_argument("chain", help="polygon/137, base/8453, or sepolia/11155111")
    parser.add_argument("--port", type=int, default=0, help="Localhost port; 0 selects an unused port")
    parser.add_argument("--block", type=int, help="Nonnegative source block; default latest")
    parser.add_argument("--duration", type=float, help="Seconds to run after readiness; default until Ctrl-C")
    args = parser.parse_args(argv)
    try:
        if args.duration is not None and (not math.isfinite(args.duration) or args.duration < 0):
            raise ForkError("Duration must be finite and nonnegative")
        with running_fork(args.chain, args.port, args.block) as info:
            print(json.dumps({**info, "kind": "local-fork", "funding": "Synthetic Anvil development balances; no public funds"}), flush=True)
            deadline = None if args.duration is None else time.monotonic() + args.duration
            while deadline is None or time.monotonic() < deadline:
                time.sleep(1 if deadline is None else min(1, max(0, deadline - time.monotonic())))
                _rpc(info["rpc_url"], "eth_chainId", [], timeout=1)
        return 0
    except ForkInterrupted as error:
        return 128 + error.signum
    except KeyboardInterrupt:
        return 130
    except ForkError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
