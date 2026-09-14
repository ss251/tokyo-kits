# SPDX-License-Identifier: MIT
"""Offline policy/process fixtures only: these tests never launch Anvil or contact RPC."""
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fork

HASH = "0x" + "ab" * 32
OTHER_HASH = "0x" + "cd" * 32
UPSTREAM = "https://offline-fixture.invalid/rpc?api_key=private-fixture"
BLOCK = {"number": "0x7b", "hash": HASH}


class ConfigurationTests(unittest.TestCase):
    def test_chain_names_and_ids_are_exact(self):
        for name, expected in (("polygon", 137), ("base", 8453), ("sepolia", 11155111)):
            for value in (name, expected, str(expected)):
                self.assertEqual(fork.resolve_chain(value), (name, expected))
        for value in (1, True, "mainnet", "https://private.invalid"):
            with self.assertRaisesRegex(fork.ForkError, "Unsupported chain"):
                fork.resolve_chain(value)

    def test_url_policy_preserves_private_query_but_rejects_unsafe_endpoints(self):
        for value in (UPSTREAM, "http://localhost:8545", "http://127.0.0.1:8545", "http://[::1]:8545"):
            self.assertEqual(fork.validate_rpc_url(value), value)
        for value in ("http://remote.invalid", "https://user:secret@rpc.invalid", "https://rpc.invalid/#secret",
                      "file:///tmp/rpc", "https:///missing-host", "https://rpc.invalid:99999", "https://rpc.invalid\n"):
            with self.assertRaises(fork.ForkError) as context:
                fork.validate_rpc_url(value)
            self.assertNotIn("secret", str(context.exception))

    def test_known_env_parser_ignores_unrelated_values_and_preserves_exports(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"BASE_RPC_URL": "https://exported.invalid"}, clear=True):
            path = Path(directory) / ".env"
            path.write_text("# settings\nBASE_RPC_URL='https://file.invalid' # ignored precedence\n"
                            'POLYGON_RPC_URL = "https://polygon.invalid/?key=private-fixture"\n'
                            "SEPOLIA_RPC_URL= # use fallback\nENS_RPC_URL=https://ens.invalid # comment\n"
                            "UNRELATED_SECRET=$(do-not-parse-this)\n", encoding="utf-8")
            capture = io.StringIO()
            with redirect_stdout(capture), redirect_stderr(capture):
                fork.load_env_file(path)
            self.assertEqual(os.environ["BASE_RPC_URL"], "https://exported.invalid")
            self.assertEqual(os.environ["POLYGON_RPC_URL"], "https://polygon.invalid/?key=private-fixture")
            self.assertEqual(os.environ["SEPOLIA_RPC_URL"], "")
            self.assertEqual(os.environ["ENS_RPC_URL"], "https://ens.invalid")
            self.assertNotIn("UNRELATED_SECRET", os.environ)
            self.assertEqual(capture.getvalue(), "")

    def test_known_env_rejects_shell_syntax_without_echoing_values(self):
        values = ["export BASE_RPC_URL=https://rpc.invalid", "BASE_RPC_URL=$(private-fixture)",
                  "BASE_RPC_URL='https://rpc.invalid", 'BASE_RPC_URL="https://rpc.invalid" ; private-fixture',
                  "BASE_RPC_URL https://rpc.invalid"]
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            path = Path(directory) / ".env"
            for value in values:
                path.write_text(value, encoding="utf-8")
                with self.assertRaises(fork.ForkError) as context:
                    fork.load_env_file(path)
                self.assertNotIn("private-fixture", str(context.exception))

    def test_explicit_url_then_exported_env_then_default_and_ens_fallback(self):
        with patch.dict(os.environ, {"SEPOLIA_RPC_URL": "https://sepolia.invalid", "ENS_RPC_URL": "https://ens.invalid"}, clear=True), patch.object(fork, "load_env_file") as loader:
            self.assertEqual(fork.upstream_url("sepolia", UPSTREAM), UPSTREAM)
            loader.assert_not_called()
            self.assertEqual(fork.upstream_url("sepolia"), "https://sepolia.invalid")
            del os.environ["SEPOLIA_RPC_URL"]
            self.assertEqual(fork.upstream_url("sepolia"), "https://ens.invalid")
            del os.environ["ENS_RPC_URL"]
            self.assertEqual(fork.upstream_url("sepolia"), fork.CHAINS["sepolia"][2])

    def test_default_env_file_is_relative_to_module_not_working_directory(self):
        path = Path(fork.__file__).resolve().parent / ".env"
        with patch.object(Path, "open", autospec=True, side_effect=FileNotFoundError) as opened:
            fork.load_env_file()
        opened.assert_called_once_with(path, encoding="utf-8")
        self.assertEqual(path.parent.name, "common")


class ProcessPolicyTests(unittest.TestCase):
    def test_command_uses_fixed_low_priority_localhost_single_thread_without_state_writes(self):
        args = fork.anvil_command(8453, 8549, 123, UPSTREAM)
        self.assertEqual(args[:4], ["nice", "-n", "19", "anvil"])
        for flag, value in (("--host", "127.0.0.1"), ("--threads", "1"), ("--chain-id", "8453"),
                            ("--fork-block-number", "123"), ("--fork-url", UPSTREAM)):
            self.assertEqual(args[args.index(flag) + 1], value)
        for forbidden in ("--mnemonic", "--config-out", "--dump-state", "--state", "--auto-impersonate", "--disable-pool-balance-checks"):
            self.assertNotIn(forbidden, args)
        self.assertIn("--no-storage-caching", args)

    def test_invalid_block_or_port_never_reaches_process_start(self):
        with patch.object(fork.subprocess, "Popen") as spawn:
            for kwargs in ({"port": -1}, {"port": 65536}, {"port": True}, {"block": -1}, {"block": True}):
                with self.assertRaises(fork.ForkError), fork.running_fork("base", rpc_url=UPSTREAM, **kwargs):
                    self.fail("Should not yield")
            spawn.assert_not_called()

    def test_load_gate_waits_without_starting_work_above_threshold(self):
        with patch.object(fork.subprocess, "run", return_value=MagicMock(returncode=0, stdout="offline uptime fixture")), \
                patch.object(fork.os, "getloadavg", side_effect=[(26.0, 1, 1), (25.0, 1, 1)]), \
                patch.object(fork.time, "sleep") as sleep, redirect_stderr(io.StringIO()):
            fork._wait_for_load()
            sleep.assert_called_once_with(10)

    def test_wrong_upstream_chain_refuses_spawn(self):
        with patch.object(fork, "_wait_for_load"), patch.object(fork, "_rpc", return_value="0x1"), patch.object(fork.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(fork.ForkError, "Upstream chain ID"), fork.running_fork("base", rpc_url=UPSTREAM):
                self.fail("Should not yield")
            spawn.assert_not_called()

    def test_context_returns_only_local_metadata_and_cleans_up_on_body_failure(self):
        process = MagicMock(); process.poll.return_value = None
        capture = io.StringIO()
        with patch.object(fork, "_wait_for_load"), patch.object(fork, "_choose_port", return_value=8549), \
                patch.object(fork, "_rpc", side_effect=["0x2105", BLOCK, "0x2105", BLOCK]), \
                patch.object(fork.subprocess, "Popen", return_value=process) as spawn, patch.object(fork, "_stop") as stop, \
                redirect_stdout(capture), redirect_stderr(capture):
            with self.assertRaisesRegex(ValueError, "body failure"):
                with fork.running_fork("base", rpc_url=UPSTREAM) as info:
                    self.assertEqual(info, {"rpc_url": "http://127.0.0.1:8549", "chain_id": 8453, "source_block": 123, "source_hash": HASH})
                    self.assertNotIn("private-fixture", json.dumps(info))
                    raise ValueError("body failure")
            stop.assert_called_once_with(process)
            self.assertEqual(spawn.call_args.kwargs["stdout"], fork.subprocess.DEVNULL)
            self.assertEqual(spawn.call_args.kwargs["stderr"], fork.subprocess.DEVNULL)
            self.assertTrue(spawn.call_args.kwargs["start_new_session"])
            self.assertFalse(spawn.call_args.kwargs.get("shell", False))
        self.assertNotIn("private-fixture", capture.getvalue())

    def test_reorganization_does_not_yield_a_mislabeled_fork(self):
        process = MagicMock(); process.poll.return_value = None
        with patch.object(fork, "_wait_for_load"), patch.object(fork, "_choose_port", return_value=8549), \
                patch.object(fork, "_rpc", side_effect=["0x2105", BLOCK, "0x2105", {**BLOCK, "hash": OTHER_HASH}]), \
                patch.object(fork.subprocess, "Popen", return_value=process), patch.object(fork, "_stop") as stop:
            with self.assertRaisesRegex(fork.ForkError, "source block hash mismatch"), fork.running_fork("base", rpc_url=UPSTREAM):
                self.fail("Should not yield")
            stop.assert_called_once_with(process)

    def test_sigterm_cleans_up_and_restores_previous_handler(self):
        process = MagicMock(); process.poll.return_value = None
        previous = signal.getsignal(signal.SIGTERM)
        with patch.object(fork, "_wait_for_load"), patch.object(fork, "_choose_port", return_value=8549), \
                patch.object(fork, "_rpc", side_effect=["0x2105", BLOCK, "0x2105", BLOCK]), \
                patch.object(fork.subprocess, "Popen", return_value=process), patch.object(fork, "_stop") as stop:
            with self.assertRaises(fork.ForkInterrupted) as raised:
                with fork.running_fork("base", rpc_url=UPSTREAM):
                    signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            self.assertEqual(raised.exception.signum, signal.SIGTERM)
            stop.assert_called_once_with(process)
        self.assertEqual(signal.getsignal(signal.SIGTERM), previous)


if __name__ == "__main__":
    unittest.main()
