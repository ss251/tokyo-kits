#!/usr/bin/env python3
"""Run every kit's checks in order; individual kits own the shared host lock."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
KITS = ('aqua', 'uniswap', 'world', 'ens', 'sui', 'curvegrid', 'common')

class CheckInterrupted(KeyboardInterrupt):
    def __init__(self, signum):
        self.signum = signum
        super().__init__('All-kit checks interrupted')

def terminate_check(child):
    # Signal the make/serial group even if its leader just exited. The serial
    # wrapper forwards SIGTERM to its separately managed compiler process group.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()

def run_check(command, log_path, cwd):
    """Stream one check and clean its process group on either cancellation signal."""
    previous = {signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)}
    child = None
    def interrupted(signum, _frame):
        raise CheckInterrupted(signum)
    try:
        for signum in previous:
            signal.signal(signum, interrupted)
        with log_path.open('w') as log:
            child = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
            assert child.stdout
            for line in child.stdout:
                print(line, end='', flush=True)
                log.write(line)
            return child.wait()
    except BaseException:
        # A second Ctrl-C/SIGTERM must not interrupt cleanup and strand a job.
        for signum in previous:
            signal.signal(signum, signal.SIG_IGN)
        if child is not None:
            terminate_check(child)
        raise
    finally:
        if child is not None and child.stdout is not None:
            child.stdout.close()
        for signum, handler in previous.items():
            signal.signal(signum, handler)

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def main():
    started = utc()
    log_dir = ROOT / 'common/.run/check-all'
    log_dir.mkdir(parents=True, exist_ok=True)
    checks = []
    for kit in KITS:
        print(f'Checking {kit}...', flush=True)
        begin = time.monotonic()
        command = ['make', '-C', str(ROOT / kit), 'test']
        log_path = log_dir / f'{kit}.log'
        code = run_check(command, log_path, ROOT)
        checks.append({'kit': kit, 'command': ['make', '-C', kit, 'test'], 'exitCode': code,
                       'elapsedSeconds': round(time.monotonic() - begin, 3),
                       'logSha256': hashlib.sha256(log_path.read_bytes()).hexdigest()})
    passed = all(check['exitCode'] == 0 for check in checks)
    sources = {}
    for path in sorted((ROOT / 'common').glob('*.py')):
        sources[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    coverage = ROOT / 'common/coverage.json'
    sources['coverage.json'] = hashlib.sha256(coverage.read_bytes()).hexdigest()
    report = {'schemaVersion': 1, 'kind': 'sequential-test-report', 'status': 'PASS' if passed else 'FAIL',
              'startedAt': started, 'finishedAt': utc(), 'checks': checks, 'sourceFilesSha256': sources,
              'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'scope': 'Tests and offline receipt integrity; missing credentialed demos remain NOT PROVEN'}
    destination = ROOT / 'common/receipts/check-all-latest.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print(f'All-kit checks: {report["status"]}; {destination}', flush=True)
    return 0 if passed else 1

if __name__ == '__main__':
    try:
        sys.exit(main())
    except CheckInterrupted as error:
        sys.exit(128 + error.signum)
