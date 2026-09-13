#!/usr/bin/env python3
"""One compiler/test process per host, with an uptime/load gate and niceness."""
import fcntl
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time

if len(sys.argv) < 2:
    raise SystemExit("usage: serial.py COMMAND [ARGS...]")
lock = pathlib.Path(tempfile.gettempdir()) / f"tokyo-kits-build-{os.getuid()}.lock"
with lock.open("w") as handle:
    print("Waiting for the Tokyo Kits build/test lock...", flush=True)
    fcntl.flock(handle, fcntl.LOCK_EX)
    while True:
        subprocess.run(["uptime"], check=True)
        if os.getloadavg()[0] <= 25:
            break
        print("Load > 25; waiting 30 seconds before building/testing.", flush=True)
        time.sleep(30)
    child = subprocess.Popen(["nice", "-n", "19", *sys.argv[1:]], start_new_session=True)
    def terminate(signum, _frame):
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGINT, terminate)
    signal.signal(signal.SIGTERM, terminate)
    raise SystemExit(child.wait())
