# SPDX-License-Identifier: MIT
"""Harmless real Python subprocesses only; never launches kit tools or compilers."""
from contextlib import redirect_stdout
import importlib.util
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'check-all.py'
SPEC = importlib.util.spec_from_file_location('common_check_all', SCRIPT)
assert SPEC and SPEC.loader
CHECK_ALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK_ALL)


class CheckAllProcessTests(unittest.TestCase):
    def test_nonzero_exit_and_combined_output_survive_without_changing_handlers(self):
        previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'check.log'
            capture = io.StringIO()
            with redirect_stdout(capture):
                code = CHECK_ALL.run_check([sys.executable, '-u', '-c',
                    'import sys; print("before failure"); print("failure detail", file=sys.stderr); sys.exit(7)'], log, directory)
            self.assertEqual(code, 7)
            self.assertEqual(log.read_text(), 'before failure\nfailure detail\n')
            self.assertEqual(capture.getvalue(), log.read_text())
        self.assertEqual({s: signal.getsignal(s) for s in previous}, previous)

    def test_already_exited_process_group_is_a_harmless_cleanup_race(self):
        child = subprocess.Popen([sys.executable, '-c', 'pass'], start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertEqual(child.wait(timeout=5), 0)
        CHECK_ALL.terminate_check(child)
        self.assertEqual(child.returncode, 0)

    def test_sigterm_cleans_detached_check_group_and_restores_previous_handlers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Both harmless worker processes install handlers before announcing readiness.
            # A signal to only the runner PID must reach the independently created group.
            worker = root / 'worker.py'
            worker.write_text(textwrap.dedent('''
                import os, pathlib, signal, subprocess, sys, time
                root = pathlib.Path(sys.argv[1])
                role = sys.argv[2]
                descendant = None
                def stop(signum, frame):
                    (root / (role + '.terminated')).write_text(str(signum))
                    if descendant is not None:
                        descendant.wait(timeout=5)
                    raise SystemExit(0)
                signal.signal(signal.SIGTERM, stop)
                if role == 'parent':
                    descendant = subprocess.Popen([sys.executable, __file__, str(root), 'grandchild'])
                    deadline = time.monotonic() + 5
                    while not (root / 'grandchild.ready').exists():
                        if time.monotonic() > deadline:
                            raise RuntimeError('fixture readiness timeout')
                        time.sleep(0.01)
                ready = root / (role + '.ready')
                temporary = root / (role + '.ready.tmp')
                temporary.write_text(str(os.getpid()))
                temporary.replace(ready)
                while True:
                    time.sleep(1)
            '''))
            driver = root / 'driver.py'
            driver.write_text(textwrap.dedent('''
                import importlib.util, pathlib, signal, sys
                path, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
                spec = importlib.util.spec_from_file_location('actual_check_all', path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                def previous(signum, frame):
                    raise RuntimeError('prior handler should be replaced during a check')
                signal.signal(signal.SIGTERM, previous)
                old_int = signal.getsignal(signal.SIGINT)
                try:
                    module.run_check([sys.executable, str(root / 'worker.py'), str(root), 'parent'], root / 'check.log', root)
                except module.CheckInterrupted as error:
                    restored = signal.getsignal(signal.SIGTERM) is previous and signal.getsignal(signal.SIGINT) is old_int
                    (root / 'restored').write_text(str(restored))
                    raise SystemExit(128 + error.signum)
                raise SystemExit('cancellation did not interrupt the check')
            '''))
            driver_process = subprocess.Popen([sys.executable, str(driver), str(SCRIPT), str(root)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
            worker_pid = None
            grandchild_pid = None
            try:
                deadline = time.monotonic() + 8
                while not (root / 'parent.ready').exists() and driver_process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue((root / 'parent.ready').exists(), 'fixture must be ready before cancellation')
                worker_pid = int((root / 'parent.ready').read_text())
                grandchild_pid = int((root / 'grandchild.ready').read_text())
                os.kill(driver_process.pid, signal.SIGTERM)
                stdout, stderr = driver_process.communicate(timeout=10)
                self.assertEqual(driver_process.returncode, 128 + signal.SIGTERM, (stdout, stderr))
                self.assertEqual((root / 'restored').read_text(), 'True')
                for role in ('parent', 'grandchild'):
                    self.assertEqual((root / (role + '.terminated')).read_text(), str(signal.SIGTERM))
                for pid in (worker_pid, grandchild_pid):
                    with self.assertRaises(ProcessLookupError):
                        os.kill(pid, 0)
            finally:
                # Failed assertions must not leave the harmless test fixture behind.
                for ready in ('parent.ready', 'grandchild.ready'):
                    if (root / ready).exists():
                        pid = int((root / ready).read_text())
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                if driver_process.poll() is None:
                    driver_process.kill()
                driver_process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
