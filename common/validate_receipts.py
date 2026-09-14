#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Offline receipt integrity only: no RPC, execution replay, or signature verification."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

EXPECTED_IDS = {
    'aqua/app-open', 'aqua/swapvm-opcode', 'aqua/continuity-recipe',
    'uniswap/v4-hook', 'uniswap/api-swap', 'uniswap/lp-api', 'uniswap/v3-or-v2',
    'uniswap/cca', 'uniswap/continuity-recipe', 'world/minikit-app',
    'world/world-id-verify', 'world/agentkit', 'world/continuity-recipe',
    'ens/new-app-ensv2', 'ens/add-to-existing', 'sui/payments', 'sui/defi',
    'curvegrid/multibaas-basics', 'curvegrid/events-webhooks',
}
PARTIAL_STATUS = 'PARTIAL_ONLY_NOT_SPONSOR_E2E'
NOTICE = ('Offline JSON/source integrity checks only. Execution, signatures, current chain '
          'canonicality, and sponsor eligibility are not cryptographically verified. '
          'Local-fork transaction hashes are not public-chain transactions.')
HEX32 = re.compile(r'0x[0-9a-fA-F]{64}\Z')
SHA256 = re.compile(r'[0-9a-f]{64}\Z')
ADDRESS = re.compile(r'0x[0-9a-fA-F]{40}\Z')
BASE58 = re.compile(r'[1-9A-HJ-NP-Za-km-z]{32,44}\Z')


class ReceiptError(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReceiptError(message)


def object_value(value: Any, label: str) -> dict:
    require(isinstance(value, dict), f'{label}: expected object')
    return value


def nonnegative(value: Any, label: str) -> int:
    require(type(value) is int or (isinstance(value, str) and re.fullmatch(r'0|[1-9][0-9]*', value) is not None), f'{label}: invalid integer')
    result = int(value)
    require(result >= 0, f'{label}: negative integer')
    return result


def hex32(value: Any, label: str) -> str:
    require(isinstance(value, str) and HEX32.fullmatch(value) is not None and int(value, 16) != 0, f'{label}: invalid hash')
    return value.lower()


def address(value: Any, label: str) -> str:
    require(isinstance(value, str) and ADDRESS.fullmatch(value) is not None and int(value, 16) != 0, f'{label}: invalid address')
    return value.lower()


def confined_path(root: Path, relative: Any) -> Path:
    require(isinstance(relative, str) and relative and '\\' not in relative and not any(ord(c) < 32 for c in relative), 'unsafe path')
    parts = relative.split('/')
    require(not PurePosixPath(relative).is_absolute() and all(p not in ('', '.', '..', '.git', '.run') and not p.startswith('.env') for p in parts), f'unsafe path: {relative}')
    base = root.resolve()
    target = (base / relative).resolve()
    require(target.is_relative_to(base), f'unsafe path escapes root: {relative}')
    require(target.is_file(), f'missing file: {relative}')
    return target


def load_json(path: Path) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, value in items:
            require(key not in result, f'duplicate JSON key: {key}')
            result[key] = value
        return result
    def invalid_constant(value: str) -> None:
        raise ReceiptError(f'nonfinite JSON constant: {value}')
    try:
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReceiptError(f'cannot parse JSON: {path.name}: {error}') from error


def source_maps(value: Any, location: str = '$'):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == 'sourceFilesSha256':
                yield location + '.' + key, item
            else:
                yield from source_maps(item, location + '.' + key)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from source_maps(item, f'{location}[{index}]')


def validate_sources(kit: Path, receipt: dict) -> tuple[int, list[str]]:
    errors: list[str] = []
    top = object_value(receipt.get('sourceFilesSha256'), 'sourceFilesSha256')
    require({'package.json', 'bun.lock', 'addresses.json', 'scripts/demo.ts'} <= set(top), 'sourceFilesSha256: missing required package/address/runner provenance')
    checked = 0
    for location, values in source_maps(receipt):
        try:
            mapping = object_value(values, location)
            require(bool(mapping), f'{location}: empty source map')
        except ReceiptError as error:
            errors.append(str(error))
            continue
        for relative, expected in mapping.items():
            try:
                require(isinstance(expected, str) and SHA256.fullmatch(expected) is not None, f'{location}: invalid SHA-256 for {relative}')
                source = confined_path(kit, relative)
                actual = hashlib.sha256(source.read_bytes()).hexdigest()
                require(actual == expected, f'source hash mismatch: {kit.name}/{relative} (recorded {expected}, current {actual})')
                checked += 1
            except (ReceiptError, OSError) as error:
                errors.append(str(error))
    return checked, errors


def validate_official(sponsor: str, receipt: dict, config: dict) -> tuple[int, int]:
    """Compare recorded fork identity/addresses to local pinned configuration, never RPC."""
    if sponsor == 'curvegrid':
        source = object_value(receipt.get('forkSource'), 'forkSource')
        require(source.get('chainId') == config.get('chainId') == 11155111, 'wrong Curvegrid fork chain')
        hex32(source.get('blockHash'), 'fork source block hash')
        return 11155111, nonnegative(source.get('blockNumber'), 'fork block')
    chain = receipt.get('sourceChainId')
    if sponsor == 'aqua':
        chains = object_value(config.get('chains'), 'Aqua chains')
        selected = object_value(chains.get(receipt.get('sourceChain')), 'Aqua source chain')
        require(chain == selected.get('chainId') and chain in (137, 8453), 'wrong Aqua source chain')
        expected = {key: selected.get(key) for key in ('aqua', 'router')}
        fork_chain = 31337
    elif sponsor == 'uniswap':
        require(chain == config.get('chainId') == 8453, 'wrong Uniswap source chain')
        expected = {key: config.get(key) for key in ('poolManager', 'positionManager', 'stateView', 'v4Quoter', 'universalRouter', 'permit2', 'v3SwapRouter', 'v3Quoter', 'ccaFactory')}
        fork_chain = 8453
    elif sponsor == 'ens':
        require(chain == config.get('chainId') == 11155111, 'wrong ENS source chain')
        expected = object_value(config.get('contracts'), 'ENS contracts')
        fork_chain = 11155111
    elif sponsor == 'world':
        require(chain == config.get('chainId') == 480, 'wrong World source chain')
        verifiers = object_value(config.get('worldIdVerifier'), 'World verifiers')
        expected = {'agentBook': config.get('agentBook'), 'productionVerifier': verifiers.get('production'), 'stagingVerifier': verifiers.get('staging')}
        fork_chain = 480
    else:
        raise ReceiptError('unsupported fork sponsor')
    require(receipt.get('forkChainId') == fork_chain, 'wrong local fork chain ID')
    hex32(receipt.get('forkBlockHash'), 'fork block hash')
    block = nonnegative(receipt.get('forkBlock'), 'fork block')
    actual = object_value(receipt.get('official'), 'official addresses')
    code = object_value(receipt.get('codeHashes'), 'official code hashes')
    require(set(actual) == set(expected), 'official contract set mismatch')
    for name, target in expected.items():
        require(address(actual.get(name), name) == address(target, f'configured {name}'), f'official address mismatch: {name}')
        hex32(code.get(name), f'{name} code hash')
    return chain, block


def validate_evm_receipt(item: dict, minimum_block: int) -> str:
    tx_hash = hex32(item.get('transactionHash'), 'receipt transaction hash')
    hex32(item.get('blockHash'), 'receipt block hash')
    require(nonnegative(item.get('blockNumber'), 'receipt block') >= minimum_block, 'receipt predates fork')
    require(item.get('status') in ('success', 'reverted'), 'invalid receipt status')
    address(item.get('from'), 'receipt sender')
    require(nonnegative(item.get('gasUsed'), 'receipt gas') > 0, 'receipt gas must be positive')
    logs = item.get('logs')
    require(isinstance(logs, list), 'missing receipt logs')
    for value in logs:
        log = object_value(value, 'receipt log')
        require(log.get('removed') is False, 'removed log cannot be proof')
        require(hex32(log.get('transactionHash'), 'log transaction hash') == tx_hash, 'log transaction hash mismatch')
        require(hex32(log.get('blockHash'), 'log block hash') == item['blockHash'].lower(), 'log block hash mismatch')
        require(nonnegative(log.get('blockNumber'), 'log block') == nonnegative(item['blockNumber'], 'receipt block'), 'log block number mismatch')
    return tx_hash


def validate_evm_transactions(receipt: dict, sponsor: str, minimum_block: int) -> list[str]:
    transactions = receipt.get('transactions')
    if sponsor == 'curvegrid':
        require(isinstance(transactions, dict) and set(transactions) == {'deployed', 'increment', 'rejected'}, 'missing partial counter transactions')
        for name, value in transactions.items():
            require(object_value(value, name).get('status') == ('reverted' if name == 'rejected' else 'success'), f'unexpected counter {name} status')
        return [validate_evm_receipt(value, minimum_block) for value in transactions.values()]
    require(isinstance(transactions, list) and bool(transactions), 'missing executed transaction receipts')
    identifiers = []
    for item in transactions:
        pair = object_value(item, 'transaction pair')
        tx = object_value(pair.get('transaction'), 'executed transaction')
        outcome = object_value(pair.get('receipt'), 'transaction receipt')
        require(outcome.get('status') == 'success', 'main scenario transaction was not successful')
        tx_hash = validate_evm_receipt(outcome, minimum_block)
        require(hex32(tx.get('hash'), 'transaction hash') == tx_hash, 'transaction/receipt hash mismatch')
        require(tx.get('chainId') == receipt.get('forkChainId'), 'transaction chain mismatch')
        require(hex32(tx.get('blockHash'), 'transaction block hash') == outcome['blockHash'].lower(), 'transaction/receipt block mismatch')
        require(nonnegative(tx.get('blockNumber'), 'transaction block') == nonnegative(outcome['blockNumber'], 'receipt block'), 'transaction/receipt height mismatch')
        require(address(tx.get('from'), 'transaction sender') == address(outcome.get('from'), 'receipt sender'), 'transaction/receipt sender mismatch')
        identifiers.append(tx_hash)
    require(len(set(identifiers)) == len(identifiers), 'duplicate main transaction identifier')
    return identifiers


def sui_digest(value: Any, label: str) -> str:
    require(isinstance(value, str) and BASE58.fullmatch(value) is not None, f'{label}: invalid Sui digest')
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    number = 0
    for character in value:
        number = number * 58 + alphabet.index(character)
    size = (number.bit_length() + 7) // 8 + len(value) - len(value.lstrip('1'))
    require(size == 32 and number != 0, f'{label}: Sui digest must encode 32 bytes')
    return value


def validate_sui(receipt: dict, config: dict, scenario: str) -> list[str]:
    service = object_value(receipt.get('service'), 'Sui service status')
    require(config.get('network') == service.get('chain') == 'testnet', 'Sui service is not testnet')
    genesis = sui_digest(config.get('genesisDigest'), 'configured genesis')
    require(receipt.get('chainIdentifier') == service.get('chainId') == genesis, 'Sui chain identifier mismatch')
    nonnegative(service.get('checkpointHeight'), 'Sui service checkpoint')
    statuses = {'payments': 'OFFICIAL_USDC_SPONSORED_PAYMENT_PROVEN', 'defi': 'TESTNET_ESCROW_PROVEN'}
    require(receipt.get('status') == statuses.get(scenario), 'wrong Sui integration status')
    deployment = object_value(config.get('starterDeployment'), 'Sui starter deployment')
    require(hex32(receipt.get('packageId'), 'Sui package') == hex32(deployment.get('packageId'), 'configured package'), 'Sui package mismatch')
    require(isinstance(receipt.get('compiledSha256'), str) and SHA256.fullmatch(receipt['compiledSha256']) is not None, 'missing compiled package SHA-256')
    if scenario == 'payments':
        require(receipt.get('network') == 'testnet' and receipt.get('coinType') == config.get('usdcType'), 'payment is not configured official testnet USDC')
    rows = receipt.get('transactions')
    require(isinstance(rows, list) and bool(rows), 'missing Sui executed transactions')
    publication = object_value(receipt.get('publication'), 'Sui publication')
    require(publication.get('digest') == deployment.get('publicationDigest'), 'publication digest mismatch')
    identifiers = []
    for pair in [publication, *rows]:
        pair = object_value(pair, 'Sui transaction evidence')
        digest = sui_digest(pair.get('digest'), 'Sui transaction digest')
        tx = object_value(pair.get('transaction'), 'Sui transaction')
        require(tx.get('digest') == digest, 'Sui transaction digest mismatch')
        require(object_value(tx.get('status'), 'Sui status').get('success') is True, 'Sui transaction not successful')
        effects = object_value(tx.get('effects'), 'Sui effects')
        require(effects.get('transactionDigest') == digest and object_value(effects.get('status'), 'Sui effect status').get('success') is True, 'Sui effect identity/status mismatch')
        nonnegative(tx.get('checkpoint'), 'Sui transaction checkpoint')
        require(nonnegative(tx.get('timestampMs'), 'Sui transaction timestamp') > 0, 'missing Sui transaction time')
        data = object_value(tx.get('transaction'), 'Sui transaction data')
        hex32(data.get('sender'), 'Sui sender')
        signatures = tx.get('signatures')
        require(isinstance(signatures, list) and len(signatures) > 0 and all(isinstance(s, str) and s for s in signatures), 'missing recorded Sui signatures')
        if scenario == 'payments' and pair is not publication:
            require(len(signatures) == 2 and data.get('sender') == receipt.get('payer'), 'missing payer and sponsor signatures')
            require(object_value(data.get('gasData'), 'Sui gas data').get('owner') == receipt.get('sponsor') != receipt.get('payer'), 'wrong sponsored gas owner')
        identifiers.append(digest)
    require(len(set(identifiers)) == len(identifiers), 'duplicate Sui transaction identifier')
    return identifiers


def validate_receipt(root: Path, sponsor: str, spec: dict, scenario: str | None = None, partial: bool = False) -> dict:
    result: dict = {'path': spec.get('path'), 'partial': partial, 'sourceHashesChecked': 0, 'transactionIdentifiers': [], 'errors': []}
    try:
        require(sponsor in {item.split('/')[0] for item in EXPECTED_IDS}, 'unknown sponsor')
        relative = spec.get('path')
        require(isinstance(relative, str) and relative.startswith(sponsor + '/'), 'receipt outside sponsor folder')
        if partial:
            require(relative.startswith(sponsor + '/infrastructure/receipts/'), 'partial receipt must remain under infrastructure')
        else:
            require(scenario is not None and relative.startswith(f'{sponsor}/{scenario}/receipts/'), 'full receipt must belong to its subtrack')
        receipt = object_value(load_json(confined_path(root, relative)), 'receipt')
        require(receipt.get('schemaVersion') == 1, 'unsupported receipt schema')
        require(receipt.get('kind') == spec.get('kind') and spec.get('kind') in ('local-fork', 'public-testnet'), 'receipt kind mismatch')
        require(isinstance(receipt.get('sourceCommit'), str) and re.fullmatch(r'[0-9a-f]{40}', receipt['sourceCommit']) is not None, 'missing source commit')
        require(type(receipt.get('sourceDirty')) is bool, 'missing source dirty flag')
        stamp = receipt.get('provenAt', receipt.get('recordedAt'))
        require(isinstance(stamp, str), 'missing receipt time')
        parsed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        require(parsed.tzinfo is not None, 'receipt time needs timezone')
        if partial:
            require(receipt.get('status') == PARTIAL_STATUS, 'partial evidence must explicitly remain NOT_SPONSOR_E2E')
        else:
            require(receipt.get('scenario') == scenario, 'receipt scenario mismatch')
            require(receipt.get('status') != PARTIAL_STATUS and not any(word in str(receipt.get('status', '')).upper() for word in ('PARTIAL', 'NOT_PROVEN', 'NOT PROVEN', 'FIXTURE', 'SIMULATION')), 'partial or fixture receipt cannot prove a subtrack')
            require(sponsor not in ('world', 'curvegrid'), 'full World/Curvegrid receipts require a dedicated integration schema; infrastructure never qualifies')
        kit = root.resolve() / sponsor
        require(kit.resolve().is_relative_to(root.resolve()), 'sponsor source path escapes repository')
        checked, errors = validate_sources(kit, receipt)
        result['sourceHashesChecked'] = checked
        result['errors'].extend(errors)
        config = object_value(load_json(confined_path(kit, 'addresses.json')), 'address configuration')
        if receipt['kind'] == 'local-fork':
            chain, block = validate_official(sponsor, receipt, config)
            require(spec.get('sourceChainId') == chain, 'inventory source chain mismatch')
            if not partial and sponsor == 'ens':
                require(receipt.get('status') == 'PROVEN_ON_LOCAL_FORK', 'ENS scenario not proven on fork')
            result['transactionIdentifiers'] = validate_evm_transactions(receipt, sponsor, block)
        else:
            require(sponsor == 'sui' and not partial, 'unsupported public-testnet receipt schema')
            require(spec.get('chainIdentifier') == receipt.get('chainIdentifier'), 'inventory chain identifier mismatch')
            result['transactionIdentifiers'] = validate_sui(receipt, config, scenario or '')
    except (ReceiptError, OSError, ValueError, TypeError) as error:
        result['errors'].append(str(error))
    result['ok'] = not result['errors']
    return result


def validate_coverage(root: Path, coverage: Any) -> dict:
    report: dict = {'scope': 'offline-receipt-integrity', 'notice': NOTICE, 'proven': 0, 'notProven': 0, 'receipts': [], 'errors': []}
    try:
        coverage = object_value(coverage, 'coverage')
        require(coverage.get('schemaVersion') == 1 and coverage.get('scope') == report['scope'], 'unsupported coverage schema')
        entries = coverage.get('entries')
        require(isinstance(entries, list), 'missing coverage entries')
        ids = [object_value(row, 'coverage row').get('id') for row in entries]
        require(all(isinstance(i, str) for i in ids) and len(ids) == len(set(ids)) and set(ids) == EXPECTED_IDS, 'coverage must contain each of the 19 brief subtracks exactly once')
        for row in entries:
            sponsor, scenario = row['id'].split('/')
            require(row.get('sponsor') == sponsor, f'{row["id"]}: sponsor mismatch')
            blockers = row.get('blockers')
            require(isinstance(blockers, list) and all(isinstance(b, str) and b.strip() for b in blockers), f'{row["id"]}: invalid blockers')
            if row.get('status') == 'PROVEN':
                require(not blockers, f'{row["id"]}: PROVEN row still has blockers')
                result = validate_receipt(root, sponsor, object_value(row.get('receipt'), 'full receipt specification'), scenario)
                result['id'] = row['id']; report['receipts'].append(result)
                report['proven'] += 1
            else:
                require(row.get('status') == 'NOT_PROVEN' and row.get('receipt') is None and bool(blockers), f'{row["id"]}: NOT_PROVEN needs null receipt and explicit blockers')
                report['notProven'] += 1
        partials = coverage.get('partialReceipts')
        require(isinstance(partials, list), 'missing partial receipt list')
        partial_paths = set()
        for spec in partials:
            spec = object_value(spec, 'partial receipt specification')
            require(isinstance(spec.get('path'), str) and spec['path'] not in partial_paths, 'duplicate or invalid partial receipt path')
            partial_paths.add(spec['path'])
            report['receipts'].append(validate_receipt(root, spec.get('sponsor'), spec, partial=True))
    except (ReceiptError, OSError, ValueError, TypeError) as error:
        report['errors'].append(str(error))
    report['ok'] = not report['errors'] and all(row['ok'] for row in report['receipts'])
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--coverage', default='common/coverage.json', help='repository-relative inventory path')
    parser.add_argument('--json', action='store_true', dest='as_json')
    args = parser.parse_args()
    try:
        report = validate_coverage(args.root, load_json(confined_path(args.root, args.coverage)))
    except (ReceiptError, OSError) as error:
        report = {'ok': False, 'scope': 'offline-receipt-integrity', 'notice': NOTICE, 'errors': [str(error)], 'receipts': []}
    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print(NOTICE)
        print(f"Inventory: {report.get('proven', 0)} PROVEN, {report.get('notProven', 0)} NOT_PROVEN; integrity {'PASS' if report['ok'] else 'FAIL'}")
        for row in report['receipts']:
            print(f"{'PASS' if row['ok'] else 'FAIL'} {row['path']} ({'partial only' if row['partial'] else 'full integration'}; {row['sourceHashesChecked']} source hashes)")
            for error in row['errors']:
                print('  ' + error)
        for error in report['errors']:
            print('FAIL ' + error)
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
