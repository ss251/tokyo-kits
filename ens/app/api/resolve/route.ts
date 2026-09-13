import { NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { createEnsClient, ensSepolia, normalizeEnsName, readEnsConfig } from '../../../lib/ens';
import type { Resolution } from '../../types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

async function inputBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('invalid_input');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_input');
  const parts: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new Error('body_too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).input : undefined;
  } catch { throw new Error('invalid_input'); }
}

export async function POST(request: Request) {
  let input: string;
  try {
    const value = await inputBody(request);
    if (typeof value !== 'string' || !value.trim() || value.length > 255) return reply({ error: 'invalid_input' }, 400);
    input = value.trim();
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'invalid_input' }, 400); }

  // Address input is an explicit baseline path, with no ENS resolution claim.
  if (isAddress(input, { strict: false })) {
    if (BigInt(input) === 0n) return reply({ error: 'invalid_input' }, 400);
    return reply({ source: 'literal', config: { label: 'Existing configuration', recipient: getAddress(input), enabled: true, limit: 10 }, evidence: null } satisfies Resolution);
  }
  let name: string;
  try { name = normalizeEnsName(input); } catch { return reply({ error: 'invalid_name' }, 400); }
  try {
    // The configured RPC stays on the server. The adapter disables CCIP HTTP reads.
    const client = createEnsClient(process.env.ENS_RPC_URL);
    if (await client.getChainId() !== 11155111) return reply({ error: 'wrong_chain' }, 503);
    const block = await client.getBlock();
    if (!block.hash || block.number === null) return reply({ error: 'snapshot_unavailable' }, 503);
    const config = await readEnsConfig(client, name, { blockNumber: block.number });
    const result: Resolution = { source: 'ens', config: { label: config.label, recipient: config.recipient, enabled: config.enabled, limit: config.limit },
      evidence: { name: config.name, resolver: config.resolver, universalResolver: ensSepolia.contracts.ensUniversalResolver.address,
        chainId: 11155111, blockNumber: block.number.toString(), blockHash: block.hash,
        blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(), readAt: new Date().toISOString() } };
    return reply(result);
  } catch { return reply({ error: 'resolution_failed' }, 502); }
}
