#!/usr/bin/env python3
"""Install one pinned official Sui binary locally; never change global tools/keys."""
import hashlib
import json
import os
from pathlib import Path
import platform
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'toolchain.json').read_text())
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This bootstrap is pinned to macOS arm64; pin the matching official release/checksum for another host.')
directory = ROOT / '.run' / 'tooling'
directory.mkdir(parents=True, exist_ok=True)
archive = directory / 'sui.tgz'

def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

if not archive.exists() or sha(archive) != manifest['archiveSha256']:
    request = urllib.request.Request(manifest['url'], headers={'User-Agent': 'tokyo-kits/0.1'})
    temporary = archive.with_suffix('.part')
    count = 0
    with urllib.request.urlopen(request, timeout=60) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            count += len(chunk)
            if count % (50 * 1024 * 1024) == 0:
                print(f'Downloaded {count // (1024 * 1024)} MiB of the pinned Sui release', flush=True)
    if temporary.stat().st_size != manifest['archiveBytes'] or sha(temporary) != manifest['archiveSha256']:
        raise SystemExit('Official Sui archive integrity mismatch')
    temporary.replace(archive)
with tarfile.open(archive, 'r:gz') as bundle:
    candidates = [member for member in bundle.getmembers() if member.isfile() and Path(member.name).name == 'sui']
    if len(candidates) != 1:
        raise SystemExit('Expected exactly one sui binary in official archive')
    source = bundle.extractfile(candidates[0])
    assert source
    binary = directory / 'sui'
    with binary.open('wb') as output:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            output.write(chunk)
    os.chmod(binary, 0o755)
(directory / 'installed.json').write_text(json.dumps({**manifest, 'binarySha256': sha(binary)}, indent=2) + '\n')
print(f'Verified official local Sui toolchain: {binary}', flush=True)
