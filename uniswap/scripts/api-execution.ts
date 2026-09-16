import { strict as assert } from 'node:assert'
import { createWalletClient, erc20Abi, http, parseAbi, parseEventLogs, zeroAddress, type Address, type Hex } from 'viem'
import { runApiSwap } from '../api-swap/demo'
import { requireApiKey, type PreparedTransaction } from '../api-swap/client'
import { runLpApi } from '../lp-api/demo'
import type { Fork } from './fork'
import { validateLpCalldata, type LpExecutionContext } from './lp-validation'

const permitAbi = parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)'])
const positionAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
])
type Position = readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]

function validatePrepared(fork: Fork, prepared: PreparedTransaction, owner: Address, targets: Address[]) {
  const transaction = prepared.transaction
  assert.equal(transaction.chainId, fork.config.chainId)
  assert.equal(transaction.from.toLowerCase(), owner.toLowerCase())
  assert(targets.some(address => address.toLowerCase() === transaction.to.toLowerCase()), 'API returned an unexpected destination')
  assert.equal(BigInt(transaction.value), 0n, 'These ERC20 examples must not send native currency')
  return { to: transaction.to, data: transaction.data, value: 0n }
}

/** Every submitted transaction goes to the managed Anvil instance; no upstream writes. */
export async function runApiExecution(fork: Fork, kind: 'api-swap' | 'lp-api') {
  requireApiKey(kind === 'api-swap' ? 'swap' : 'lp')
  const transactions: unknown[] = []
  const confirm = async (hash: Hex, label: string) => { const proof = await fork.receipt(hash, label); transactions.push(proof); console.log(`${label}: ${hash}`); return proof }
  const { config, client, taker } = fork
  if (kind === 'api-swap') {
    const amount = 10n ** 15n
    const routers = [config.universalRouter, config.universalRouterLegacy] as Address[]
    await fork.fund(config.weth as Address, taker.account.address, amount)
    const prepared = await runApiSwap({ walletAddress: taker.account.address, simulateTransaction: false,
      signPermit: async (data) => {
        const details = data.values.details as Record<string, unknown>
        const spender = String(data.values.spender) as Address
        assert(routers.some(router => router.toLowerCase() === spender.toLowerCase()), 'Permit spender is not an allowed official router')
        assert.equal(String(details.token).toLowerCase(), config.weth.toLowerCase())
        assert.equal(BigInt(String(details.amount)), amount, 'Permit must authorize exactly the selected input')
        const now = (await client.getBlock()).timestamp
        const deadline = BigInt(String(data.values.sigDeadline))
        assert(deadline > now && deadline <= now + 86400n, 'Permit signature deadline is not bounded')
        // Sign the standard Permit2 schema, not arbitrary API-provided types.
        return taker.signTypedData({ domain: { name: 'Permit2', chainId: config.chainId, verifyingContract: config.permit2 as Address },
          types: {
            PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
            PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
          }, primaryType: 'PermitSingle', message: { details: { token: config.weth as Address, amount, expiration: Number(details.expiration), nonce: Number(details.nonce) }, spender, sigDeadline: deadline },
        })
      },
    })
    const call = validatePrepared(fork, prepared, taker.account.address, routers)
    await confirm(await taker.writeContract({ address: config.weth as Address, abi: erc20Abi, functionName: 'approve', args: [config.permit2 as Address, amount] }), 'API swap input approval')
    if (!prepared.quoteResponse.permitData) {
      const expiry = Number((await client.getBlock()).timestamp + 3600n)
      await confirm(await taker.writeContract({ address: config.permit2 as Address, abi: permitAbi, functionName: 'approve', args: [config.weth as Address, call.to, amount, expiry] }), 'API swap Permit2 allowance')
    }
    const beforeIn = await fork.balance(config.weth as Address, taker.account.address), beforeOut = await fork.balance(config.usdc as Address, taker.account.address)
    const proof = await confirm(await taker.sendTransaction(call), 'execute authenticated API swap payload on fork')
    const actualIn = beforeIn - await fork.balance(config.weth as Address, taker.account.address), actualOut = await fork.balance(config.usdc as Address, taker.account.address) - beforeOut
    const minimum = BigInt(prepared.quoteResponse.quote.output.amount) * 9950n / 10000n
    assert.equal(actualIn, amount); assert(actualOut >= minimum && actualOut > 0n)
    await fork.save(kind, { apiStatus: 'EXECUTED_ON_FORK', prepared, actualIn, actualOut, minimum, hash: proof.receipt.transactionHash, transactions })
    return
  }

  // The public LP API cannot see fork-created NFTs. Discover a public WETH/USDC
  // position, then impersonate its PUBLIC owner only on the verified local fork.
  // No owner's private key is requested, loaded, or used; no upstream tx is sent.
  const manager = config.v3PositionManager as Address
  let tokenId = Bun.env.UNISWAP_LP_POSITION_ID ? BigInt(Bun.env.UNISWAP_LP_POSITION_ID) : undefined
  if (tokenId === undefined) {
    const supply = await client.readContract({ address: manager, abi: positionAbi, functionName: 'totalSupply' })
    for (let offset = 1n; offset <= 100n && offset <= supply; offset++) {
      const candidate = await client.readContract({ address: manager, abi: positionAbi, functionName: 'tokenByIndex', args: [supply - offset] })
      const position = await client.readContract({ address: manager, abi: positionAbi, functionName: 'positions', args: [candidate] })
      if (position[2].toLowerCase() === config.weth.toLowerCase() && position[3].toLowerCase() === config.usdc.toLowerCase() && position[7] > 0n) { tokenId = candidate; break }
    }
  }
  assert(tokenId !== undefined, 'NOT PROVEN: no recent public WETH/USDC position found; set UNISWAP_LP_POSITION_ID')
  const initialPosition = await client.readContract({ address: manager, abi: positionAbi, functionName: 'positions', args: [tokenId] })
  assert.equal(initialPosition[2].toLowerCase(), config.weth.toLowerCase()); assert.equal(initialPosition[3].toLowerCase(), config.usdc.toLowerCase()); assert(initialPosition[7] > 0n)
  const owner = await client.readContract({ address: manager, abi: positionAbi, functionName: 'ownerOf', args: [tokenId] })
  const prepared = await runLpApi({ walletAddress: owner, position: { protocol: 'V3', nftTokenId: String(tokenId), token0Address: config.weth as Address, token1Address: config.usdc as Address }, independentToken: { tokenAddress: config.weth as Address, amount: '1000000000000000' } })
  const poolAbi = parseAbi(['function fee() view returns (uint24)', 'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)', 'function liquidity() view returns (uint128)'])
  const createPoolFee = await client.readContract({ address: config.v3Pool as Address, abi: poolAbi, functionName: 'fee' })
  const positionPool = await client.readContract({ address: config.v3Factory as Address, abi: parseAbi(['function getPool(address,address,uint24) view returns (address)']), functionName: 'getPool', args: [config.weth as Address, config.usdc as Address, initialPosition[4]] })
  assert(BigInt(positionPool) !== 0n, 'Official factory has no pool for the public position fee tier')
  const decimals = await Promise.all([config.weth, config.usdc].map(token => client.readContract({ address: token as Address, abi: erc20Abi, functionName: 'decimals' }))) as [number, number]
  // Pool state is re-read on the fork before every action because each executed action changes it.
  const poolState = async (pool: Address) => {
    const [slot0, liquidity] = await Promise.all([client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' }), client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity' })])
    return { sqrtPriceX96: slot0[0], tick: slot0[1], liquidity }
  }
  await fork.rpc('anvil_impersonateAccount', [owner])
  await fork.rpc('anvil_setBalance', [owner, '0x56bc75e2d63100000'])
  const wallet = createWalletClient({ account: owner, chain: taker.chain, transport: http(fork.rpcUrl) })
  try {
    const transitions = []
    for (const [action, payload] of Object.entries(prepared)) {
      assert.equal(action, payload.kind)
      const context: LpExecutionContext = {
        kind: payload.kind, owner, chainId: config.chainId, token0: config.weth as Address, token1: config.usdc as Address, decimals,
        fee: payload.kind === 'create' ? createPoolFee : initialPosition[4],
        pool: await poolState(payload.kind === 'create' ? config.v3Pool as Address : positionPool),
        tickLower: payload.kind === 'create' ? payload.response.tickLower : initialPosition[5],
        tickUpper: payload.kind === 'create' ? payload.response.tickUpper : initialPosition[6],
        tokenId, liquidityAtQuote: initialPosition[7],
        quoteAmounts: [BigInt(payload.response.token0.amount), BigInt(payload.response.token1.amount)],
        slippagePercent: payload.request.slippageTolerance ?? 0.5, now: (await client.getBlock()).timestamp,
        ...(payload.kind === 'decrease' ? { decreasePercentage: payload.request.liquidityPercentageToDecrease }
          : { independentToken: payload.request.independentToken }),
      }
      if (payload.kind === 'create') {
        assert(payload.request.tickBounds, 'This executor requires explicit create tick bounds')
        assert.equal(context.tickLower, payload.request.tickBounds.tickLower)
        assert.equal(context.tickUpper, payload.request.tickBounds.tickUpper)
      }
      const call = validatePrepared(fork, payload, owner, [manager])
      const validated = validateLpCalldata(call.data, context)
      const tokens = [context.token0, context.token1] as const
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!, budget = validated.desired[i]!
        await confirm(await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [manager, 0n] }), `clear LP ${action} allowance`)
        if (budget > 0n) {
          if (await fork.balance(token, owner) < budget) await fork.fund(token, owner, budget)
          await confirm(await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [manager, budget] }), `approve exact LP ${action} input maximum`)
        }
      }
      const beforePosition: Position = await client.readContract({ address: manager, abi: positionAbi, functionName: 'positions', args: [tokenId] })
      const beforeCount = await client.readContract({ address: manager, abi: positionAbi, functionName: 'balanceOf', args: [owner] })
      const beforeBalances = await Promise.all(tokens.map(token => fork.balance(token, owner)))
      const proof = await confirm(await wallet.sendTransaction(call), `execute authenticated LP ${action} payload on fork`)
      const afterBalances = await Promise.all(tokens.map(token => fork.balance(token, owner)))
      const afterPosition: Position = await client.readContract({ address: manager, abi: positionAbi, functionName: 'positions', args: [tokenId] })
      const afterCount = await client.readContract({ address: manager, abi: positionAbi, functionName: 'balanceOf', args: [owner] })
      const actualSpend = beforeBalances.map((balance, i) => balance - afterBalances[i]!)
      let createdTokenId: bigint | undefined
      let createdPosition: Position | undefined
      if (action === 'create') {
        assert.equal(afterCount, beforeCount + 1n)
        assert.equal(afterPosition[7], beforePosition[7], 'Create changed the existing public position')
        const minted = parseEventLogs({ abi: positionAbi, eventName: 'Transfer', logs: proof.receipt.logs.filter(log => log.address.toLowerCase() === manager.toLowerCase()) })
          .filter(log => log.args.from === zeroAddress && log.args.to.toLowerCase() === owner.toLowerCase())
        assert.equal(minted.length, 1, 'Expected exactly one newly minted NFT for this owner')
        createdTokenId = minted[0]!.args.tokenId
        createdPosition = await client.readContract({ address: manager, abi: positionAbi, functionName: 'positions', args: [createdTokenId] })
        assert.equal((await client.readContract({ address: manager, abi: positionAbi, functionName: 'ownerOf', args: [createdTokenId] })).toLowerCase(), owner.toLowerCase())
        assert.equal(createdPosition[2].toLowerCase(), context.token0.toLowerCase()); assert.equal(createdPosition[3].toLowerCase(), context.token1.toLowerCase())
        assert.equal(createdPosition[4], context.fee); assert.equal(createdPosition[5], context.tickLower); assert.equal(createdPosition[6], context.tickUpper)
        assert(createdPosition[7] > 0n, 'Minted NFT has no liquidity')
      } else {
        assert.equal(afterCount, beforeCount)
        assert.equal((await client.readContract({ address: manager, abi: positionAbi, functionName: 'ownerOf', args: [tokenId] })).toLowerCase(), owner.toLowerCase())
        assert.deepEqual(afterPosition.slice(2, 7), initialPosition.slice(2, 7), 'Existing NFT pool/range changed')
      }
      if (action === 'increase') assert(afterPosition[7] > beforePosition[7])
      if (action === 'decrease') {
        assert.equal(beforePosition[7] - afterPosition[7], validated.liquidityRemoved)
        for (let i = 0; i < 2; i++) assert(-actualSpend[i]! >= validated.minimums[i]!, 'Collected LP withdrawal falls below minimum')
      } else {
        for (let i = 0; i < 2; i++) assert(actualSpend[i]! >= validated.minimums[i]! && actualSpend[i]! <= validated.desired[i]!, 'LP actual spend is outside validated bounds')
        assert(actualSpend.some(amount => amount > 0n), 'LP action did not deposit tokens')
        const increases = parseEventLogs({ abi: positionAbi, eventName: 'IncreaseLiquidity', logs: proof.receipt.logs.filter(log => log.address.toLowerCase() === manager.toLowerCase()) })
        assert.equal(increases.length, 1)
        assert.equal(increases[0]!.args.tokenId, createdTokenId ?? tokenId)
        assert.equal(increases[0]!.args.amount0, actualSpend[0]); assert.equal(increases[0]!.args.amount1, actualSpend[1])
      }
      for (const token of tokens) await confirm(await wallet.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [manager, 0n] }), `revoke LP ${action} allowance`)
      transitions.push({ action, validation: validated, beforeLiquidity: beforePosition[7], afterLiquidity: afterPosition[7], beforeCount, afterCount, beforeBalances, afterBalances, actualSpend, createdTokenId, createdPosition, hash: proof.receipt.transactionHash })
    }
    await fork.save(kind, { apiStatus: 'EXECUTED_ON_FORK', publicPosition: tokenId, impersonatedOwnerOnForkOnly: owner, prepared, transitions, transactions })
  } finally { await fork.rpc('anvil_stopImpersonatingAccount', [owner]) }
}
