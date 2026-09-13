import { NextResponse } from 'next/server';
import { WorldIdError } from '../../world-id-verify/server/store';
import { appOrigin } from './config';

export function requireOrigin(request: Request): void {
  if (request.headers.get('origin') !== appOrigin()) throw new WorldIdError('origin_rejected', 403);
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  requireOrigin(request);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new WorldIdError('json_required', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new WorldIdError('body_required', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 96_000) { await reader.cancel(); throw new WorldIdError('body_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new WorldIdError('invalid_json', 400); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new WorldIdError('object_required', 400);
  return result as Record<string, unknown>;
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown) {
  return json({ error: error instanceof WorldIdError ? error.code : 'request_failed' }, error instanceof WorldIdError ? error.status : 500);
}
export function cookieSettings(maxAge: number) {
  return { httpOnly: true, secure: appOrigin().startsWith('https:'), sameSite: 'strict' as const, path: '/', maxAge };
}
