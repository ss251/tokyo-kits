import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { worldchain } from 'viem/chains';
import { WorldIdError } from '../../../../world-id-verify/server/store';
import { publicConfig, rpcUrl } from '../../../_server/config';
import { failure, json, requireOrigin } from '../../../_server/http';
import { rememberPing, session, SESSION_COOKIE } from '../../../_server/wallet-auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const config = publicConfig();
    if (!config.pingReady || !config.pingAddress) throw new WorldIdError('public_ping_not_configured', 503);
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const identity = session(token, true);
    const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl(), { timeout: 10_000, retryCount: 0 }) });
    if (await client.getChainId() !== 480) throw new WorldIdError('wrong_ping_chain', 503);
    const code = await client.getCode({ address: config.pingAddress });
    if (!code || code === '0x') throw new WorldIdError('public_ping_has_no_code', 503);
    const note = `0x${randomBytes(32).toString('hex')}` as Hex;
    const data = encodeFunctionData({ abi: parseAbi(['function ping(bytes32 note)']), functionName: 'ping', args: [note] });
    rememberPing(token!, note, identity.wallet, config.pingAddress);
    return json({ to: config.pingAddress, data, value: '0x0', note, chainId: 480 });
  } catch (error) { return failure(error); }
}
