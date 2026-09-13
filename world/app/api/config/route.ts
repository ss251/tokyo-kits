import { publicConfig } from '../../_server/config';
import { failure, json } from '../../_server/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() { try { return json(publicConfig()); } catch (error) { return failure(error); } }
