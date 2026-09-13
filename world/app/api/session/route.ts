import type { NextRequest } from 'next/server';
import { removeSession, session, SESSION_COOKIE } from '../../_server/wallet-auth';
import { cookieSettings, failure, json, requireOrigin } from '../../_server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return json(session(request.cookies.get(SESSION_COOKIE)?.value)); } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    requireOrigin(request); removeSession(request.cookies.get(SESSION_COOKIE)?.value);
    const response = json({ disconnected: true }); response.cookies.set(SESSION_COOKIE, '', cookieSettings(0)); return response;
  } catch (error) { return failure(error); }
}
