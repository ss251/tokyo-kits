import { createNonce, NONCE_COOKIE } from '../../../_server/wallet-auth';
import { cookieSettings, failure, json, requireOrigin } from '../../../_server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const nonce = createNonce(); const response = json(nonce);
    response.cookies.set(NONCE_COOKIE, nonce.id, cookieSettings(300)); return response;
  } catch (error) { return failure(error); }
}
