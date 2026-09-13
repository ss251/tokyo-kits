import type { NextRequest } from 'next/server';
import { completeWalletAuth, NONCE_COOKIE, SESSION_COOKIE } from '../../../_server/wallet-auth';
import { cookieSettings, failure, json, readBody } from '../../../_server/http';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await readBody(request);
    const verified = await completeWalletAuth(request.cookies.get(NONCE_COOKIE)?.value, body.payload);
    const response = json(verified.session);
    response.cookies.set(SESSION_COOKIE, verified.token, cookieSettings(3600));
    response.cookies.set(NONCE_COOKIE, '', cookieSettings(0)); return response;
  } catch (error) { return failure(error); }
}
