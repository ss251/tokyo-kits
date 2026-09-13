import type { NextRequest } from 'next/server';
import { createPublicClient, http, parseAbi, parseEventLogs, TransactionReceiptNotFoundError, type Hex } from 'viem';
import { worldchain } from 'viem/chains';
import { WorldIdError } from '../../../../world-id-verify/server/store';
import { rpcUrl } from '../../../_server/config';
import { failure, json, readBody } from '../../../_server/http';
import { findPing, session, SESSION_COOKIE } from '../../../_server/wallet-auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request); const token = request.cookies.get(SESSION_COOKIE)?.value;
    const identity = session(token, true);
    if (typeof body.note !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.note)) throw new WorldIdError('invalid_ping_note', 400);
    const ping = findPing(token!, body.note);
    if (ping.wallet.toLowerCase() !== identity.wallet.toLowerCase()) throw new WorldIdError('ping_wallet_mismatch', 403);
    let transactionHash: Hex;
    if (typeof body.transactionHash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(body.transactionHash)) transactionHash = body.transactionHash as Hex;
    else {
      if (typeof body.userOpHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.userOpHash)) throw new WorldIdError('invalid_user_operation_hash', 400);
      // Same public endpoint used by @worldcoin/minikit-react 2.0.3. No API key is required by its SDK implementation.
      const response = await fetch(`https://developer.world.org/api/v2/minikit/userop/${body.userOpHash}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new WorldIdError('userop_lookup_unavailable', 503);
      const data = await response.json() as Record<string, unknown>;
      if (!data || typeof data !== 'object' || (data.userOpHash && String(data.userOpHash).toLowerCase() !== body.userOpHash.toLowerCase())) throw new WorldIdError('userop_response_mismatch', 502);
      if (data.status === 'failed') throw new WorldIdError('user_operation_failed', 409);
      if (typeof data.transaction_hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(data.transaction_hash)) return json({ status: 'submitted', userOpHash: body.userOpHash });
      transactionHash = data.transaction_hash as Hex;
    }
    const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl(), { timeout: 10_000, retryCount: 0 }) });
    if (await client.getChainId() !== 480) throw new WorldIdError('wrong_receipt_chain', 503);
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: transactionHash }); }
    catch (error) { if (error instanceof TransactionReceiptNotFoundError) return json({ status: 'submitted', transactionHash }); throw error; }
    if (receipt.status !== 'success') throw new WorldIdError('ping_transaction_reverted', 409);
    const events = parseEventLogs({ abi: parseAbi(['event Ping(address indexed sender,bytes32 note)']), eventName: 'Ping',
      logs: receipt.logs.filter(log => log.address.toLowerCase() === ping.target.toLowerCase()) });
    if (!events.some(event => event.args.sender.toLowerCase() === ping.wallet.toLowerCase() && event.args.note.toLowerCase() === body.note)) throw new WorldIdError('matching_ping_event_missing', 409);
    return json({ status: 'confirmed', transactionHash, blockNumber: receipt.blockNumber.toString(), sender: ping.wallet, contract: ping.target, note: body.note, chainId: 480 });
  } catch (error) { return failure(error); }
}
