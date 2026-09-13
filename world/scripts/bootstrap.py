#!/usr/bin/env python3
"""Fetch immutable upstream source archives without running dependency scripts."""
import io
import json
import pathlib
import tarfile
import tempfile
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
deps = json.loads((root / "solidity-dependencies.json").read_text())
(root / "lib").mkdir(exist_ok=True)
for name, dep in deps.items():
    dest = root / "lib" / name
    marker = dest / ".tokyo-kits-commit"
    if marker.exists() and marker.read_text().strip() == dep["commit"]:
        continue
    if dest.exists():
        raise SystemExit(f"Refusing to overwrite {dest}; move it aside to change the source pin.")
    url = f'https://codeload.github.com/{dep["repository"]}/tar.gz/{dep["commit"]}'
    print(f'Fetching {dep["repository"]}@{dep["commit"]}', flush=True)
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read()
    with tempfile.TemporaryDirectory(dir=root / "lib") as tmp:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            archive.extractall(tmp, filter="data")
        children = list(pathlib.Path(tmp).iterdir())
        if len(children) != 1 or not children[0].is_dir():
            raise SystemExit("Unexpected source archive layout")
        children[0].rename(dest)
    marker.write_text(dep["commit"] + "\n")
