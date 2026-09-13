// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert'
import {
  BaseError, ContractFunctionRevertedError, concatHex, encodeAbiParameters,
  erc20Abi, keccak256, parseAbi, parseAbiParameters, parseEventLogs, toHex,
  zeroAddress, type Hex,
} from 'viem'
import type { Fork } from './fork'

// ABI and schedule layout: Uniswap/continuous-clearing-auction tag v2.1.0,
// src/interfaces/IContinuousClearingAuction.sol and src/libraries/StepLib.sol.
export const MPS = 10_000_000n
export const Q96 = 1n << 96n
const UINT64_MAX = (1n << 64n) - 1n
export type AuctionStep = { mps: bigint; blockDelta: bigint }

/** Each step is uint24 mps-per-block followed by uint40 block count, big endian. */
export function encodeAuctionSteps(steps: readonly AuctionStep[], startBlock: bigint, endBlock: bigint): Hex {
  if (startBlock < 0n || startBlock > UINT64_MAX || endBlock > UINT64_MAX || endBlock <= startBlock) {
    throw new Error('Auction blocks must be uint64 values with endBlock > startBlock')
  }
  if (steps.length === 0) throw new Error('At least one auction step is required')
  let blocks = 0n, totalMps = 0n
  const packed = steps.map(({ mps, blockDelta }) => {
    if (mps < 0n || mps >= (1n << 24n)) throw new Error('Step mps must fit uint24')
    if (blockDelta <= 0n || blockDelta >= (1n << 40n)) throw new Error('Step blockDelta must be a positive uint40')
    blocks += blockDelta
    totalMps += mps * blockDelta
    return concatHex([toHex(mps, { size: 3 }), toHex(blockDelta, { size: 5 })])
  })
  if (totalMps !== MPS) throw new Error('Sum of mps × blockDelta must equal 10000000 (100%)')
  if (startBlock + blocks !== endBlock) throw new Error('Step durations must exactly cover startBlock to endBlock')
  return concatHex(packed)
}

export const AUCTION_PARAMETERS = parseAbiParameters(
  '(address currency,address tokensRecipient,address fundsRecipient,uint64 startBlock,uint64 endBlock,uint64 claimBlock,uint256 tickSpacing,address validationHook,uint256 floorPrice,uint128 requiredCurrencyRaised,bytes auctionStepsData)',
)

/** A 20-block bidding period with no issuance, followed by 100 equal issuance blocks. */
export function createDemoSchedule(startBlock: bigint, claimDelay = 10n) {
  if (claimDelay < 0n) throw new Error('claimDelay must not be negative')
  const endBlock = startBlock + 120n
  const claimBlock = endBlock + claimDelay
  if (claimBlock > UINT64_MAX) throw new Error('claimBlock must fit uint64')
  const steps = [{ mps: 0n, blockDelta: 20n }, { mps: 100_000n, blockDelta: 100n }]
  return { startBlock, endBlock, claimBlock, steps, auctionStepsData: encodeAuctionSteps(steps, startBlock, endBlock) }
}

const factoryAbi = parseAbi([
  'function create(address token,uint256 amount,bytes configData,bytes32 salt) returns (address distributor)',
  'function getAddress(address token,uint256 amount,bytes configData,bytes32 salt,address sender) view returns (address distributor)',
  'function protocolFeeController() view returns (address)',
  'event AuctionCreated(address indexed auction,address indexed token,uint256 amount,bytes configData)',
])
const auctionAbi = parseAbi([
  'function onTokensReceived()',
  'function submitBid(uint256 maxPriceQ96,uint128 amount,address owner,uint256 prevTickPriceQ96,bytes hookData) payable returns (uint256 bidId)',
  'function checkpoint() returns ((uint256 clearingPrice,uint256 currencyRaisedAtClearingPriceQ96X7,uint256 cumulativeMpsPerPrice,uint24 cumulativeMps,uint64 prev,uint64 next))',
  'function exitBid(uint256 bidId)',
  'function claimTokens(uint256 bidId)',
  'function sweepCurrency()',
  'function sweepUnsoldTokens()',
  'function token() view returns (address)',
  'function currency() view returns (address)',
  'function totalSupply() view returns (uint128)',
  'function startBlock() view returns (uint64)',
  'function endBlock() view returns (uint64)',
  'function claimBlock() view returns (uint64)',
  'function lastCheckpointedBlock() view returns (uint64)',
  'function clearingPrice() view returns (uint256)',
  'function currencyRaised() view returns (uint256)',
  'function totalCleared() view returns (uint256)',
  'function remainingSupply() view returns (uint256)',
  'function isGraduated() view returns (bool)',
  'function bids(uint256 bidId) view returns ((uint64 startBlock,uint24 startCumulativeMps,uint64 exitedBlock,uint256 maxPrice,address owner,uint256 amountQ96,uint256 tokensFilled))',
  'function latestCheckpoint() view returns ((uint256 clearingPrice,uint256 currencyRaisedAtClearingPriceQ96X7,uint256 cumulativeMpsPerPrice,uint24 cumulativeMps,uint64 prev,uint64 next))',
  'function sweepCurrencyBlock() view returns (uint256)',
  'function sweepUnsoldTokensBlock() view returns (uint256)',
  'event TokensReceived(uint128 totalSupply)',
  'event BidSubmitted(uint256 indexed id,address indexed owner,uint256 priceQ96,uint128 amount)',
  'event BidExited(uint256 indexed bidId,address indexed owner,uint256 tokensFilled,uint256 currencyRefunded)',
  'event TokensClaimed(uint256 indexed bidId,address indexed owner,uint256 tokensFilled)',
  'event CurrencySwept(address indexed fundsRecipient,uint256 currencyAmount)',
  'event TokensSwept(address indexed tokensRecipient,uint256 tokensAmount)',
  'error InvalidTokenAmountReceived()',
  'error AuctionNotStarted()',
  'error AuctionIsNotOver()',
  'error AuctionIsOver()',
  'error NotClaimable()',
  'error BidAlreadyExited()',
  'error NotAuthorized(address authorized,address caller)',
  'error CannotSweepCurrency()',
  'error CannotSweepTokens()',
])

/** Complete local-fork lifecycle through the deployed official factory, never a replacement. */
export async function runCca(fork: Fork): Promise<void> {
  const factory = fork.config.ccaFactory as `0x${string}`
  const token = fork.config.dai as `0x${string}`
  const maker = fork.maker.account.address, bidder = fork.taker.account.address
  const transactions: Awaited<ReturnType<Fork['receipt']>>[] = []
  const negativeChecks: { label: string; errorName: string; atBlock: bigint; kind: 'eth_call' }[] = []
  const mined: { from: bigint; to: bigint; blocks: bigint }[] = []
  const blockNumber = async () => BigInt(await fork.rpc('eth_blockNumber', []))
  async function mineTo(target: bigint) {
    const from = await blockNumber()
    assert(target >= from, 'Cannot mine backward')
    if (target > from) await fork.rpc('anvil_mine', [toHex(target - from)])
    assert.equal(await blockNumber(), target)
    mined.push({ from, to: target, blocks: target - from })
  }
  async function record(hash: Hex, label: string) {
    const proof = await fork.receipt(hash, label)
    transactions.push(proof)
    console.log(`cca ${label}: ${hash}`)
    return proof
  }
  async function expectRevert(label: string, errorName: string, action: () => Promise<unknown>) {
    try {
      await action()
      assert.fail(`${label} unexpectedly succeeded`)
    } catch (error) {
      assert(error instanceof BaseError, `${label}: expected a decoded contract revert, got ${String(error)}`)
      const revert = error.walk(cause => cause instanceof ContractFunctionRevertedError)
      assert(revert instanceof ContractFunctionRevertedError, `${label}: no contract revert found`)
      assert.equal(revert.data?.errorName, errorName, `${label}: wrong revert`)
    }
    negativeChecks.push({ label, errorName, atBlock: await blockNumber(), kind: 'eth_call' })
  }

  assert.equal(fork.config.chainId, 8453, 'CCA demo is pinned to Base')
  assert.equal(factory.toLowerCase(), '0x000000001f26a0044baa66024e7b6599c61963f8', 'Unexpected CCA factory')
  const factoryCode = await fork.client.getCode({ address: factory })
  assert(factoryCode && factoryCode !== '0x', 'Official CCA v2.1.0 factory has no code at this fork block')
  assert.equal(await fork.client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }), 18)
  const protocolFeeController = await fork.client.readContract({ address: factory, abi: factoryAbi, functionName: 'protocolFeeController' })
  const supply = 1_000n * 10n ** 18n, bidAmount = 10n ** 18n
  if (await fork.balance(token, maker) < supply) await fork.fund(token, maker, supply)
  const makerTokensBefore = await fork.balance(token, maker)
  const bidderTokensBefore = await fork.balance(token, bidder)
  const schedule = createDemoSchedule(await blockNumber() + 20n)
  const tickSpacing = Q96 / 10_000n, floorPrice = tickSpacing * 100n, maxPrice = floorPrice * 10n
  const parameters = {
    currency: zeroAddress, tokensRecipient: maker, fundsRecipient: maker,
    startBlock: schedule.startBlock, endBlock: schedule.endBlock, claimBlock: schedule.claimBlock,
    tickSpacing, validationHook: zeroAddress, floorPrice, requiredCurrencyRaised: bidAmount / 2n,
    auctionStepsData: schedule.auctionStepsData,
  }
  const configData = encodeAbiParameters(AUCTION_PARAMETERS, [parameters])
  const salt = keccak256(encodeAbiParameters(parseAbiParameters('address,uint64'), [maker, schedule.startBlock]))
  const auction = await fork.client.readContract({ address: factory, abi: factoryAbi, functionName: 'getAddress', args: [token, supply, configData, salt, maker] })
  const created = await record(await fork.maker.writeContract({ address: factory, abi: factoryAbi, functionName: 'create', args: [token, supply, configData, salt] }), 'create via official factory')
  const [createdEvent] = parseEventLogs({ abi: factoryAbi, eventName: 'AuctionCreated', logs: created.receipt.logs.filter(log => log.address.toLowerCase() === factory.toLowerCase()) })
  assert(createdEvent)
  assert.equal(createdEvent.args.auction.toLowerCase(), auction.toLowerCase(), 'CREATE2 prediction differs from factory event')
  assert.equal(createdEvent.args.token.toLowerCase(), token.toLowerCase())
  assert.equal(createdEvent.args.amount, supply)
  assert.equal(createdEvent.args.configData, configData)
  const auctionCode = await fork.client.getCode({ address: auction })
  assert(auctionCode && auctionCode !== '0x')
  assert.equal((await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'token' })).toLowerCase(), token.toLowerCase())
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'currency' }), zeroAddress)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'totalSupply' }), supply)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'claimBlock' }), schedule.claimBlock)
  await expectRevert('cannot initialize unfunded inventory', 'InvalidTokenAmountReceived', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'onTokensReceived' }))
  await record(await fork.maker.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [auction, supply] }), 'transfer auction inventory')
  assert.equal(await fork.balance(token, auction), supply)
  assert.equal(makerTokensBefore - await fork.balance(token, maker), supply)
  const received = await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'onTokensReceived' }), 'confirm tokens received')
  const [receivedEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'TokensReceived', logs: received.receipt.logs })
  assert(receivedEvent); assert.equal(receivedEvent.args.totalSupply, supply)

  const bidArgs = [maxPrice, bidAmount, bidder, floorPrice, '0x'] as const
  await expectRevert('bid before start', 'AuctionNotStarted', () => fork.client.simulateContract({ account: fork.taker.account, address: auction, abi: auctionAbi, functionName: 'submitBid', args: bidArgs, value: bidAmount }))
  await mineTo(schedule.startBlock)
  await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'checkpoint' }), 'checkpoint bidding period')
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'isGraduated' }), false)
  const currencyBeforeBid = await fork.client.getBalance({ address: auction })
  const bidProof = await record(await fork.taker.writeContract({ address: auction, abi: auctionAbi, functionName: 'submitBid', args: bidArgs, value: bidAmount }), 'submit native ETH bid')
  const [bidEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'BidSubmitted', logs: bidProof.receipt.logs })
  assert(bidEvent)
  const bidId = bidEvent.args.id
  assert.equal(bidEvent.args.amount, bidAmount)
  assert.equal(bidEvent.args.owner.toLowerCase(), bidder.toLowerCase())
  assert.equal(await fork.client.getBalance({ address: auction }) - currencyBeforeBid, bidAmount)
  const bidBeforeExit = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'bids', args: [bidId] })
  assert.equal(bidBeforeExit.exitedBlock, 0n)
  assert.equal(bidBeforeExit.startCumulativeMps, 0)
  assert.equal(bidBeforeExit.amountQ96, bidAmount * Q96)
  await expectRevert('exit before auction end', 'AuctionIsNotOver', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'exitBid', args: [bidId] }))
  await expectRevert('claim during auction', 'NotClaimable', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'claimTokens', args: [bidId] }))

  await mineTo(schedule.startBlock + 70n)
  await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'checkpoint' }), 'checkpoint mid auction')
  const middleCheckpoint = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'latestCheckpoint' })
  assert(middleCheckpoint.cumulativeMps > 0 && BigInt(middleCheckpoint.cumulativeMps) < MPS)
  await mineTo(schedule.endBlock)
  await expectRevert('bid at end boundary', 'AuctionIsOver', () => fork.client.simulateContract({ account: fork.taker.account, address: auction, abi: auctionAbi, functionName: 'submitBid', args: bidArgs, value: bidAmount }))
  await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'checkpoint' }), 'checkpoint final state')
  const finalCheckpoint = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'latestCheckpoint' })
  const currencyRaised = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'currencyRaised' })
  const tokensCleared = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'totalCleared' })
  const unsold = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'remainingSupply' })
  assert.equal(BigInt(finalCheckpoint.cumulativeMps), MPS)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'lastCheckpointedBlock' }), schedule.endBlock)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'isGraduated' }), true)
  assert(currencyRaised >= parameters.requiredCurrencyRaised && currencyRaised <= bidAmount)
  assert(finalCheckpoint.clearingPrice < maxPrice, 'This example expects the fully-filled exitBid branch')
  assert(tokensCleared > 0n && tokensCleared < supply)

  const bidderEthBeforeExit = await fork.client.getBalance({ address: bidder })
  const exit = await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'exitBid', args: [bidId] }), 'exit bid and refund unused currency')
  const [exitEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'BidExited', logs: exit.receipt.logs })
  assert(exitEvent)
  assert.equal(exitEvent.args.bidId, bidId)
  const filled = exitEvent.args.tokensFilled, refunded = exitEvent.args.currencyRefunded
  assert(filled > 0n && filled <= tokensCleared)
  assert.equal(await fork.client.getBalance({ address: bidder }) - bidderEthBeforeExit, refunded)
  assert.equal(await fork.balance(token, bidder), bidderTokensBefore, 'Exiting must not claim tokens')
  const bidAfterExit = await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'bids', args: [bidId] })
  assert.equal(bidAfterExit.tokensFilled, filled)
  assert.equal(bidAfterExit.exitedBlock, exit.receipt.blockNumber)
  await expectRevert('cannot exit twice', 'BidAlreadyExited', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'exitBid', args: [bidId] }))
  await mineTo(schedule.claimBlock - 1n)
  await expectRevert('claim one block before eligibility', 'NotClaimable', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'claimTokens', args: [bidId] }))
  await mineTo(schedule.claimBlock)
  await fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'claimTokens', args: [bidId] })
  const claim = await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'claimTokens', args: [bidId] }), 'claim purchased tokens')
  const [claimEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'TokensClaimed', logs: claim.receipt.logs })
  assert(claimEvent); assert.equal(claimEvent.args.tokensFilled, filled)
  assert.equal(await fork.balance(token, bidder) - bidderTokensBefore, filled)
  assert.equal((await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'bids', args: [bidId] })).tokensFilled, 0n)
  await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'claimTokens', args: [bidId] }), 'repeat claim has no additional payout')
  assert.equal(await fork.balance(token, bidder) - bidderTokensBefore, filled)
  await expectRevert('bidder cannot sweep proceeds', 'NotAuthorized', () => fork.client.simulateContract({ account: fork.taker.account, address: auction, abi: auctionAbi, functionName: 'sweepCurrency' }))

  const makerEthBeforeSweep = await fork.client.getBalance({ address: maker })
  const auctionEthBeforeSweep = await fork.client.getBalance({ address: auction })
  const sweepCurrency = await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'sweepCurrency' }), 'sweep raised currency and protocol fee')
  const [currencyEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'CurrencySwept', logs: sweepCurrency.receipt.logs })
  assert(currencyEvent)
  const recipientProceeds = currencyEvent.args.currencyAmount
  const sweepGas = sweepCurrency.receipt.gasUsed * sweepCurrency.receipt.effectiveGasPrice
  assert.equal(currencyEvent.args.fundsRecipient.toLowerCase(), maker.toLowerCase())
  assert(recipientProceeds > 0n && recipientProceeds <= currencyRaised)
  assert.equal(await fork.client.getBalance({ address: maker }) - makerEthBeforeSweep + sweepGas, recipientProceeds)
  assert.equal(auctionEthBeforeSweep - await fork.client.getBalance({ address: auction }), currencyRaised)
  const makerTokensBeforeSweep = await fork.balance(token, maker)
  const sweepTokens = await record(await fork.maker.writeContract({ address: auction, abi: auctionAbi, functionName: 'sweepUnsoldTokens' }), 'sweep unsold inventory')
  const [tokensEvent] = parseEventLogs({ abi: auctionAbi, eventName: 'TokensSwept', logs: sweepTokens.receipt.logs })
  assert(tokensEvent); assert.equal(tokensEvent.args.tokensAmount, unsold)
  assert.equal(await fork.balance(token, maker) - makerTokensBeforeSweep, unsold)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'sweepCurrencyBlock' }), sweepCurrency.receipt.blockNumber)
  assert.equal(await fork.client.readContract({ address: auction, abi: auctionAbi, functionName: 'sweepUnsoldTokensBlock' }), sweepTokens.receipt.blockNumber)
  await expectRevert('cannot sweep currency twice', 'CannotSweepCurrency', () => fork.client.simulateContract({ account: fork.maker.account, address: auction, abi: auctionAbi, functionName: 'sweepCurrency' }))
  const tokenDust = await fork.balance(token, auction), currencyDust = await fork.client.getBalance({ address: auction })
  assert.equal(filled + unsold + tokenDust, supply, 'Auction inventory must reconcile')
  assert.equal(refunded + currencyRaised + currencyDust, bidAmount, 'Bid currency must reconcile')
  assert(tokenDust <= 2n && currencyDust <= 2n, 'Only atomic-unit accounting rounding dust is expected')

  await fork.save('cca', {
    factory, factoryVersion: '2.1.0', factoryCodeHash: keccak256(factoryCode), auction, auctionCodeHash: keccak256(auctionCode),
    source: 'https://github.com/Uniswap/continuous-clearing-auction/tree/v2.1.0', protocolFeeController,
    token, currency: zeroAddress, fixture: 'Synthetic DAI inventory on an isolated Base fork; prices are demonstration parameters',
    maker, bidder, parameters, schedule, salt, configData, supply, bidId, bidAmount, mined,
    middleCheckpoint, finalCheckpoint, bidBeforeExit, bidAfterExit, tokensCleared, filled, unsold, tokenDust,
    currencyRaised, refunded, recipientProceeds, protocolFee: currencyRaised - recipientProceeds, currencyDust,
    assertions: ['official factory CREATE2 deployment and inventory receipt', 'time boundaries reject bids and premature claims with exact errors', 'checkpoints advance issuance and graduate the auction', 'exit, claim, currency sweep and unsold-token sweep match actual balance changes', 'repeat claim has no extra payout; repeat exit/sweep revert', 'token inventory and bid currency reconcile including atomic rounding dust'],
    negativeChecks, transactions,
  })
}
