import type { Hex } from 'viem';
import { worldIdService } from '../../../_server/service';
import { verifiedSession, SESSION_COOKIE } from '../../../_server/wallet-auth';
import { cookieSettings, failure, json, readBody } from '../../../_server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const verified = await worldIdService().verify({ challengeId: body.challengeId as string, walletSignature: body.walletSignature as Hex, result: body.result });
    const authenticated = verifiedSession(verified);
    const response = json({ ...authenticated.session, verifiedAt: verified.verifiedAt, environment: verified.environment });
    response.cookies.set(SESSION_COOKIE, authenticated.token, cookieSettings(3600)); return response;
  } catch (error) { return failure(error); }
}
