#!/usr/bin/env python3
"""Reproduce the checked-in official ENSv2 ABIs; --check verifies them offline."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify checked-in artifacts without network access")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "addresses.json").read_text())
    revision = manifest["sourceCommit"]
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Expected a pinned official source commit")
    base = f"https://raw.githubusercontent.com/ensdomains/contracts-v2/{revision}/contracts/deployments/sepolia/"
    for name, artifact in manifest["artifacts"].items():
        if not re.fullmatch(r"[A-Za-z0-9]+", name):
            raise ValueError("Invalid ABI name")
        target = ROOT / "abi" / f"{name}.json"
        expected_url = f"{base}{name}.json"
        if artifact["source"] != expected_url:
            raise ValueError(f"{name}: source must be the pinned official deployment")
        if args.check:
            encoded = target.read_bytes()
        else:
            request = urllib.request.Request(expected_url, headers={"User-Agent": "tokyo-kits/0.1"})
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
            if digest(raw) != artifact["sourceSha256"]:
                raise ValueError(f"{name}: official deployment source hash mismatch")
            deployment = json.loads(raw)
            if deployment["address"].lower() != manifest["contracts"][name].lower():
                raise ValueError(f"{name}: deployed address does not match manifest")
            encoded = (json.dumps(deployment["abi"], indent=2) + "\n").encode()
        if digest(encoded) != artifact["abiSha256"]:
            raise ValueError(f"{name}: ABI hash mismatch")
        if not isinstance(json.loads(encoded), list):
            raise ValueError(f"{name}: expected an ABI array")
        if not args.check:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(".json.tmp")
            temporary.write_bytes(encoded)
            temporary.replace(target)
        print(f"verified {name} {artifact['abiSha256']}")


if __name__ == "__main__":
    main()
