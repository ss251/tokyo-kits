// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test';
import { ABI as AquaABI } from '@1inch/aqua-sdk';
import { ABI, AquaProgramBuilder, HexString, TakerTraits, instructions } from '@1inch/swap-vm-sdk';
import { decodeAbiParameters, decodeFunctionData, keccak256, type Hex } from 'viem';
import {
  buildCustomOpcodeOrder,
  buildExtructionOrder,
  buildPeggedOrder,
  encodeDock,
  encodeQuote,
  encodeShip,
  encodeSwap,
  getOfficialDeployments,
  type SupportedChainId,
} from '../scripts/strategies';

const maker = '0x0000000000000000000000000000000000000001' as Hex;
const low = '0x0000000000000000000000000000000000000010' as Hex;
const high = '0x0000000000000000000000000000000000000020' as Hex;
const target = '0x0000000000000000000000000000000000000030' as Hex;
const first = { address: low, decimals: 6, reserve: 10_000n * 10n ** 6n };
const second = { address: high, decimals: 18, reserve: 10_000n * 10n ** 18n };
const pegged = () => buildPeggedOrder(maker, first, second);

describe('official Aqua strategy calldata', () => {
  test('pins the registry and router on both supported forks and refuses unknown chains', () => {
    for (const chain of [137, 8453] as const) {
      const deployment = getOfficialDeployments(chain);
      expect(deployment.aqua.toLowerCase()).toBe('0x1111113ccf1426a8e30e2bff5e005d929bf6a90a');
      expect(deployment.router.toLowerCase()).toBe('0x111111338c5091e8440b67b168bae16a668ac0de');
    }
    expect(() => getOfficialDeployments(31337 as SupportedChainId)).toThrow('Only Polygon and Base');
  });

  test('normalizes mixed decimals and preserves pegged pricing when the input token order reverses', () => {
    const order = pegged();
    expect(order.program.toString()).not.toBe('0x');
    expect(buildPeggedOrder(maker, second, first).encode().toString()).toBe(order.encode().toString());
    const [ix] = AquaProgramBuilder.decode(order.program).getInstructions();
    expect(ix?.args.toJSON()).toEqual({
      x0: (10_000n * 10n ** 18n).toString(),
      y0: (10_000n * 10n ** 18n).toString(),
      linearWidth: (8n * 10n ** 26n).toString(),
      rateLt: (10n ** 12n).toString(),
      rateGt: '1',
    });
    expect(() => buildPeggedOrder(maker, first, first)).toThrow('distinct tokens');
  });

  test('ships sorted token allocations to the official router and docks the same strategy hash', () => {
    const order = pegged();
    const ship = encodeShip(order, [{ token: high, amount: 200n }, { token: low, amount: 100n }]);
    expect(ship.to.toLowerCase()).toBe(getOfficialDeployments().aqua.toLowerCase());
    const decoded = decodeFunctionData({ abi: AquaABI.AQUA_ABI, data: ship.data });
    expect(decoded.functionName).toBe('ship');
    if (decoded.functionName !== 'ship') throw new Error('Expected ship');
    expect(decoded.args[0].toLowerCase()).toBe(getOfficialDeployments().router.toLowerCase());
    expect(decoded.args[1]).toBe(order.encode().toString());
    expect(decoded.args[2]).toEqual([low, high]);
    expect(decoded.args[3]).toEqual([100n, 200n]);
    const dock = decodeFunctionData({ abi: AquaABI.AQUA_ABI, data: encodeDock(order, [high, low]).data });
    expect(dock.functionName).toBe('dock');
    if (dock.functionName !== 'dock') throw new Error('Expected dock');
    expect(dock.args[1]).toBe(keccak256(order.encode().toString()));
    expect(dock.args[2]).toEqual([low, high]);
    expect(() => encodeShip(order, [{ token: low, amount: 1n }, { token: low, amount: 2n }])).toThrow('Duplicate');
  });

  test('encodes exact quote equality as a strict taker threshold and rejects an unprotected fill', () => {
    const params = { order: pegged(), tokenIn: low, tokenOut: high, amount: 100n };
    const quote = decodeFunctionData({ abi: ABI.SWAP_VM_ABI, data: encodeQuote(params).data });
    expect(quote.functionName).toBe('quote');
    expect(() => encodeSwap(params)).toThrow('positive threshold');
    const swap = decodeFunctionData({
      abi: ABI.SWAP_VM_ABI,
      data: encodeSwap({ ...params, threshold: 99n, strictThreshold: true }).data,
    });
    expect(swap.functionName).toBe('swap');
    if (swap.functionName !== 'swap') throw new Error('Expected swap');
    const traits = TakerTraits.decode(new HexString(swap.args[4]));
    expect(traits.exactIn).toBe(true);
    expect(traits.threshold).toBe(99n);
    expect(traits.strictThreshold).toBe(true);
    expect(traits.useTransferFromAndAquaPush).toBe(true);
    expect(() => traits.validate(100n, 98n)).toThrow();
    expect(() => traits.validate(100n, 99n)).not.toThrow();
  });

  test('preserves fixed-rate pair direction inside the official Extruction instruction', () => {
    const order = buildExtructionOrder(maker, target, high, low, 7n, 3n);
    const [ix] = AquaProgramBuilder.decode(order.program).getInstructions();
    expect(ix?.opcode.id).toBe(instructions.extruction.extruction.id);
    const decoded = ix?.args.toJSON();
    expect(decoded?.target).toBe(target);
    const data = decoded?.extructionArgs;
    if (typeof data !== 'string') throw new Error('Expected encoded Extruction arguments');
    const args = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
      data as Hex,
    );
    expect(args).toEqual([high, low, 7n, 3n]);
    expect(() => buildExtructionOrder(maker, target, high, low, 1n, 0n)).toThrow('Denominator');
    const custom = buildCustomOpcodeOrder(maker, high, low, 7n, 3n);
    expect(custom.program.toString()).toBe(`0x2280${data.slice(2)}`);
  });
});
