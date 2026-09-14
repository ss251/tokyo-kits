# SPDX-License-Identifier: MIT
"""Synthetic integrity fixtures only; these tests are not blockchain execution proof."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_receipts import (  # noqa: E402
    EXPECTED_IDS, PARTIAL_STATUS, ReceiptError, confined_path, load_json,
    validate_coverage, validate_receipt,
)

TX = '0x' + 'ab' * 32
BLOCK = '0x' + 'bc' * 32
SENDER = '0x' + '12' * 20
AQUA = '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a'
ROUTER = '0x111111338c5091e8440b67b168bae16a668ac0de'


class ReceiptIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'kits'
        self.kit = self.root / 'aqua'
        self.kit.mkdir(parents=True)
        self.config = {'chains': {'polygon': {'chainId': 137, 'aqua': AQUA, 'router': ROUTER}}}
        contents = {
            'package.json': '{"license":"MIT"}',
            'bun.lock': 'synthetic dependency lock fixture',
            'addresses.json': json.dumps(self.config),
            'scripts/demo.ts': '// synthetic fixture source; not executed',
        }
        source_hashes = {}
        for relative, content in contents.items():
            path = self.kit / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            source_hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.spec = {'path': 'aqua/app-open/receipts/polygon-latest.json', 'kind': 'local-fork', 'sourceChainId': 137}
        self.receipt = {
            'schemaVersion': 1, 'kind': 'local-fork', 'scenario': 'app-open',
            'provenAt': '2026-09-14T00:00:00.000Z', 'sourceCommit': 'a' * 40,
            'sourceDirty': False, 'sourceFilesSha256': source_hashes,
            'sourceChain': 'polygon', 'sourceChainId': 137, 'forkChainId': 31337,
            'forkBlock': '100', 'forkBlockHash': '0x' + 'cd' * 32,
            'official': {'aqua': AQUA, 'router': ROUTER},
            'codeHashes': {'aqua': '0x' + '34' * 32, 'router': '0x' + '56' * 32},
            'transactions': [{'label': 'synthetic example', 'transaction': {
                'hash': TX, 'chainId': 31337, 'blockHash': BLOCK, 'blockNumber': '101', 'from': SENDER,
            }, 'receipt': {
                'transactionHash': TX, 'blockHash': BLOCK, 'blockNumber': '101',
                'status': 'success', 'from': SENDER, 'gasUsed': '21000', 'logs': [],
            }}],
        }
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        path = self.root / self.spec['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.receipt))

    def check(self):
        self.save()
        return validate_receipt(self.root, 'aqua', self.spec, 'app-open')

    def assertFailure(self, fragment):
        result = self.check()
        self.assertFalse(result['ok'], result)
        self.assertIn(fragment, '\n'.join(result['errors']))

    def test_matches_current_source_hashes_and_structured_receipt(self):
        result = self.check()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['sourceHashesChecked'], 4)
        self.assertEqual(result['transactionIdentifiers'], [TX])

    def test_changed_source_fails_without_rewriting_recorded_hash(self):
        (self.kit / 'scripts/demo.ts').write_text('// altered after evidence')
        self.assertFailure('source hash mismatch: aqua/scripts/demo.ts')

    def test_missing_source_and_receipt_files_fail(self):
        (self.kit / 'scripts/demo.ts').unlink()
        self.assertFailure('missing file: scripts/demo.ts')
        (self.root / self.spec['path']).unlink()
        result = validate_receipt(self.root, 'aqua', self.spec, 'app-open')
        self.assertFalse(result['ok'])
        self.assertIn('missing file:', '\n'.join(result['errors']))

    def test_all_nested_source_maps_are_checked(self):
        self.receipt['evidence'] = {'sourceFilesSha256': {'package.json': '0' * 64}}
        self.assertFailure('source hash mismatch: aqua/package.json')

    def test_removing_required_source_provenance_fails(self):
        del self.receipt['sourceFilesSha256']['scripts/demo.ts']
        self.assertFailure('missing required package/address/runner provenance')

    def test_unsafe_source_paths_rejected_before_file_read(self):
        for relative in ('../outside.txt', '/tmp/outside.txt', 'scripts/../../outside.txt', '.run/secret.json', '.env', 'scripts\\demo.ts'):
            with self.subTest(relative=relative):
                self.receipt['nested'] = {'sourceFilesSha256': {relative: '1' * 64}}
                self.assertFailure('unsafe path')

    def test_symlink_source_cannot_escape_sponsor_root(self):
        outside = self.root / 'outside.txt'
        outside.write_text('private unrelated fixture')
        (self.kit / 'linked.txt').symlink_to(outside)
        self.receipt['sourceFilesSha256']['linked.txt'] = hashlib.sha256(outside.read_bytes()).hexdigest()
        self.assertFailure('unsafe path escapes root')

    def test_receipt_path_cannot_escape_repository(self):
        with self.assertRaisesRegex(ReceiptError, 'unsafe path'):
            confined_path(self.root, '../outside.json')
        outside = Path(self.temp.name) / 'outside.json'
        outside.write_text('{}')
        (self.root / 'linked.json').symlink_to(outside)
        with self.assertRaisesRegex(ReceiptError, 'unsafe path escapes root'):
            confined_path(self.root, 'linked.json')

    def test_partial_receipt_cannot_be_promoted_to_full(self):
        self.receipt['status'] = PARTIAL_STATUS
        self.assertFailure('partial or fixture receipt cannot prove a subtrack')

    def test_partial_path_never_qualifies_for_a_subtrack(self):
        self.spec['path'] = 'aqua/infrastructure/receipts/polygon-latest.json'
        self.assertFailure('full receipt must belong to its subtrack')

    def test_hash_string_without_executed_receipt_is_not_evidence(self):
        self.receipt['transactions'] = [TX]
        self.assertFailure('transaction pair: expected object')

    def test_failed_or_inconsistent_transaction_is_rejected(self):
        tx = self.receipt['transactions'][0]
        tx['receipt']['status'] = 'reverted'
        self.assertFailure('main scenario transaction was not successful')
        tx['receipt']['status'] = 'success'
        tx['transaction']['hash'] = '0x' + 'ff' * 32
        self.assertFailure('transaction/receipt hash mismatch')

    def test_wrong_fork_chain_and_changed_official_address_fail(self):
        self.receipt['forkChainId'] = 137
        self.assertFailure('wrong local fork chain ID')
        self.receipt['forkChainId'] = 31337
        self.receipt['official']['aqua'] = SENDER
        self.assertFailure('official address mismatch: aqua')

    def test_public_testnet_label_cannot_relabel_a_fork(self):
        self.spec['kind'] = 'public-testnet'
        self.assertFailure('receipt kind mismatch')
        self.receipt['kind'] = 'public-testnet'
        self.assertFailure('unsupported public-testnet receipt schema')

    def test_duplicate_keys_and_nonfinite_json_are_rejected(self):
        path = self.root / self.spec['path']
        for raw, fragment in [('{"status":1,"status":2}', 'duplicate JSON key'), ('{"value":NaN}', 'nonfinite JSON constant'), ('{bad}', 'cannot parse JSON')]:
            with self.subTest(raw=raw):
                path.write_text(raw)
                with self.assertRaisesRegex(ReceiptError, fragment):
                    load_json(path)

    def inventory(self):
        rows = [{'id': item, 'sponsor': item.split('/')[0], 'status': 'NOT_PROVEN', 'receipt': None,
                 'blockers': ['Synthetic test fixture; live integration not exercised.']} for item in sorted(EXPECTED_IDS)]
        return {'schemaVersion': 1, 'scope': 'offline-receipt-integrity', 'entries': rows, 'partialReceipts': []}

    def test_inventory_counts_full_and_blocked_rows_separately(self):
        inventory = self.inventory()
        row = next(row for row in inventory['entries'] if row['id'] == 'aqua/app-open')
        row.update(status='PROVEN', receipt=self.spec, blockers=[])
        report = validate_coverage(self.root, inventory)
        self.assertTrue(report['ok'], report)
        self.assertEqual((report['proven'], report['notProven']), (1, 18))
        self.assertIn('not cryptographically verified', report['notice'])

    def test_inventory_requires_all19_once_and_blockers_for_missing_proof(self):
        inventory = self.inventory()
        inventory['entries'].pop()
        self.assertFalse(validate_coverage(self.root, inventory)['ok'])
        inventory = self.inventory()
        inventory['entries'][0]['blockers'] = []
        self.assertFalse(validate_coverage(self.root, inventory)['ok'])
        inventory = self.inventory()
        inventory['entries'][0]['receipt'] = self.spec
        self.assertFalse(validate_coverage(self.root, inventory)['ok'])

    def test_inventory_cannot_count_partial_as_proven(self):
        inventory = self.inventory()
        row = next(row for row in inventory['entries'] if row['id'] == 'aqua/app-open')
        row.update(status='PROVEN', receipt=copy.deepcopy(self.spec), blockers=[])
        self.receipt['status'] = PARTIAL_STATUS
        self.save()
        report = validate_coverage(self.root, inventory)
        self.assertFalse(report['ok'])
        self.assertFalse(report['receipts'][0]['ok'])


if __name__ == '__main__':
    unittest.main()
