import { worldIdService } from '../../../_server/service';
import { failure, json, readBody } from '../../../_server/http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const body = await readBody(request); return json(worldIdService().challenge(body.wallet)); }
  catch (error) { return failure(error); }
}
