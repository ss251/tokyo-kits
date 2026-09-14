#!/usr/bin/env python3
"""Prove local fork plumbing with one tiny native transfer on each supported fork."""
import datetime
import hashlib
import json
from pathlib import Path
import secrets
import time
import urllib.parse
import urllib.request
from fork import running_fork

ROOT = Path(__file__).resolve().parent

def rpc(url, method, params):
    parsed = urllib.parse.urlsplit(url)
    assert parsed.scheme == 'http' and parsed.hostname == '127.0.0.1', 'Canary writes require a loopback fork'
    data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(url, data, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        result = json.load(response)
    if 'error' in result or 'result' not in result:
        raise RuntimeError(f'Local fork RPC failed during {method}')
    return result['result']

def main():
    paths = list(ROOT.glob('*.py')) + list((ROOT / 'tests').glob('*.py'))
    source_hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
    for chain in ('polygon', 'base', 'sepolia'):
        with running_fork(chain) as fork:
            url = fork['rpc_url']
            assert int(rpc(url, 'eth_chainId', []), 16) == fork['chain_id']
            accounts = rpc(url, 'eth_accounts', [])
            assert accounts
            sender = accounts[0]
            # Publicly known Anvil addresses can already carry code/delegations on an upstream chain.
            recipient = '0x' + secrets.token_hex(20)
            assert recipient.lower() != sender.lower()
            assert rpc(url, 'eth_getCode', [recipient, 'latest']) == '0x'
            before = int(rpc(url, 'eth_getBalance', [recipient, 'latest']), 16)
            transaction = rpc(url, 'eth_sendTransaction', [{'from': sender, 'to': recipient, 'value': '0x1', 'gas': '0x5208'}])
            deadline = time.monotonic() + 15
            receipt = rpc(url, 'eth_getTransactionReceipt', [transaction])
            while receipt is None and time.monotonic() < deadline:
                time.sleep(0.25)
                receipt = rpc(url, 'eth_getTransactionReceipt', [transaction])
            assert receipt and receipt['status'] == '0x1'
            assert receipt['transactionHash'] == transaction
            assert receipt['from'].lower() == sender.lower() and receipt['to'].lower() == recipient.lower()
            assert int(receipt['gasUsed'], 16) == 21000
            canonical = rpc(url, 'eth_getBlockByNumber', [receipt['blockNumber'], False])
            assert canonical['hash'] == receipt['blockHash']
            after = int(rpc(url, 'eth_getBalance', [recipient, 'latest']), 16)
            assert after == before + 1
            evidence = {'schemaVersion': 1, 'kind': 'local-fork', 'status': 'COMMON_FORK_PLUMBING_PROVEN',
                        'provenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'scope': 'Anvil network, transaction, balance and receipt plumbing; not sponsor integration evidence',
                        'chain': chain, 'source': {key: fork[key] for key in ('chain_id', 'source_block', 'source_hash')},
                        'funding': 'Default Anvil development balances. The 1-wei transfer exists only on the local fork.',
                        'transactionHash': transaction, 'receipt': receipt, 'recipientBalanceBefore': str(before),
                        'recipientBalanceAfter': str(after), 'sourceFilesSha256': source_hashes}
            path = ROOT / 'receipts' / f'{chain}-fork-latest.json'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(evidence, indent=2) + '\n')
            print(f'{chain} fork canary: {transaction}; {path}', flush=True)

if __name__ == '__main__':
    main()
