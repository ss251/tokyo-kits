// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'bun:test'
import { decodeAbiParameters, encodeAbiParameters, zeroAddress } from 'viem'
import { AUCTION_PARAMETERS, MPS, createDemoSchedule, encodeAuctionSteps } from '../scripts/cca'

describe('CCA v2.1.0 issuance schedule encoding', () => {
  test('matches the official uint24 | uint40 byte layout, including a zero-issuance period', () => {
    const schedule = createDemoSchedule(100n)
    expect(schedule.auctionStepsData).toBe('0x00000000000000140186a00000000064')
    expect(schedule.endBlock).toBe(220n)
    expect(schedule.claimBlock).toBe(230n)
    const bytes = schedule.auctionStepsData.slice(2)
    const parsed = [0, 16].map(offset => ({
      mps: BigInt(`0x${bytes.slice(offset, offset + 6)}`),
      blocks: BigInt(`0x${bytes.slice(offset + 6, offset + 16)}`),
    }))
    expect(parsed.reduce((sum, step) => sum + step.mps * step.blocks, 0n)).toBe(MPS)
    expect(parsed.reduce((sum, step) => sum + step.blocks, 0n)).toBe(120n)
  })

  test('accepts a one-block full release and a claim block exactly at auction end', () => {
    expect(encodeAuctionSteps([{ mps: MPS, blockDelta: 1n }], 9n, 10n)).toBe('0x9896800000000001')
    const schedule = createDemoSchedule(0n, 0n)
    expect(schedule.claimBlock).toBe(schedule.endBlock)
  })

  test('rejects issuance totals that confuse percentage per step with percentage per block', () => {
    expect(() => encodeAuctionSteps([{ mps: MPS, blockDelta: 100n }], 0n, 100n)).toThrow('10000000')
    expect(() => encodeAuctionSteps([{ mps: MPS - 1n, blockDelta: 1n }], 0n, 1n)).toThrow('10000000')
    expect(() => encodeAuctionSteps([{ mps: 0n, blockDelta: 1n }], 0n, 1n)).toThrow('10000000')
  })

  test('rejects empty schedules, zero duration, overflow, and mismatched end blocks', () => {
    expect(() => encodeAuctionSteps([], 1n, 2n)).toThrow('At least one')
    expect(() => encodeAuctionSteps([{ mps: MPS, blockDelta: 0n }], 1n, 2n)).toThrow('positive uint40')
    expect(() => encodeAuctionSteps([{ mps: 1n << 24n, blockDelta: 1n }], 1n, 2n)).toThrow('uint24')
    expect(() => encodeAuctionSteps([{ mps: -1n, blockDelta: 1n }], 1n, 2n)).toThrow('uint24')
    expect(() => encodeAuctionSteps([{ mps: 0n, blockDelta: 1n << 40n }], 0n, 1n << 40n)).toThrow('positive uint40')
    expect(() => encodeAuctionSteps([{ mps: MPS, blockDelta: 1n }], 1n, 3n)).toThrow('exactly cover')
    expect(() => encodeAuctionSteps([{ mps: MPS, blockDelta: 1n }], -1n, 0n)).toThrow('uint64')
    expect(() => createDemoSchedule((1n << 64n) - 120n)).toThrow('uint64')
    expect(() => createDemoSchedule(0n, -1n)).toThrow('negative')
  })

  test('preserves a maximum uint40 no-issuance duration and uint64 end boundary', () => {
    const maximumDelta = (1n << 40n) - 1n, endBlock = (1n << 64n) - 1n
    const encoded = encodeAuctionSteps([
      { mps: 0n, blockDelta: maximumDelta }, { mps: MPS, blockDelta: 1n },
    ], endBlock - maximumDelta - 1n, endBlock)
    expect(encoded).toBe('0x000000ffffffffff9896800000000001')
  })

  test('encodes the official AuctionParameters tuple with dynamic schedule bytes in its final field', () => {
    const schedule = createDemoSchedule(100n)
    const recipient = '0x0000000000000000000000000000000000000002' as const
    const parameters = {
      currency: zeroAddress, tokensRecipient: recipient, fundsRecipient: recipient,
      startBlock: schedule.startBlock, endBlock: schedule.endBlock, claimBlock: schedule.claimBlock,
      tickSpacing: 2n, validationHook: zeroAddress, floorPrice: (1n << 32n) + 2n,
      requiredCurrencyRaised: 1n, auctionStepsData: schedule.auctionStepsData,
    }
    const encoded = encodeAbiParameters(AUCTION_PARAMETERS, [parameters])
    const [decoded] = decodeAbiParameters(AUCTION_PARAMETERS, encoded)
    expect(decoded).toEqual(parameters)
    // The outer tuple is dynamic, so its ABI starts with an offset of one word.
    expect(BigInt(`0x${encoded.slice(2, 66)}`)).toBe(32n)
  })
})
