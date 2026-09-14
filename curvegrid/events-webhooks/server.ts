// SPDX-License-Identifier: MIT
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { WebhookStore } from './store';
import { EVENT_SIGNATURE, MAX_BODY_BYTES, validateWebhookConfig, verifyDelivery, WebhookError, type WebhookConfig } from './verify';

export interface ServerOptions { config: WebhookConfig; store: WebhookStore; hostname?: string; port?: number }
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function bodyBytes(request: Request): Promise<Uint8Array> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new WebhookError('invalid_content_type', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new WebhookError('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookError('invalid_payload', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new WebhookError('body_too_large', 413); }
    chunks.push(next.value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export function startWebhookServer(options: ServerOptions) {
  const config = validateWebhookConfig(options.config);
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new WebhookError('invalid_configuration', 500);
  return Bun.serve({ hostname: options.hostname ?? '127.0.0.1', port, maxRequestBodySize: MAX_BODY_BYTES, idleTimeout: 15,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return reply({ ok: true, chainId: config.chainId });
      if (path !== '/webhook') return reply({ error: 'not_found' }, 404);
      if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
      try {
        const body = await bodyBytes(request);
        const delivery = verifyDelivery(body, request.headers.get('x-multibaas-signature'), request.headers.get('x-multibaas-timestamp'), config);
        return reply({ ok: true, ...options.store.ingest(delivery) });
      } catch (error) {
        if (error instanceof WebhookError) return reply({ error: error.code }, error.status);
        // SDK/HTTP/SQLite exceptions can contain request data. Never log them verbatim.
        console.error('webhook_receiver_error');
        return reply({ error: 'receiver_error' }, 500);
      }
    },
    error() { return reply({ error: 'receiver_error' }, 500); },
  });
}

async function configFromEnvironment(): Promise<WebhookConfig> {
  const kitRoot = resolve(import.meta.dir, '..');
  const path = resolve(kitRoot, Bun.env.MULTIBAAS_WEBHOOK_CONFIG ?? '.run/webhook-config.json');
  if (await Bun.file(path).exists()) {
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw new WebhookError('webhook_config_must_be_private', 500);
    return validateWebhookConfig(await Bun.file(path).json() as WebhookConfig);
  }
  if (Bun.env.MULTIBAAS_WEBHOOK_CONFIG) throw new WebhookError('webhook_config_missing', 500);
  return validateWebhookConfig({ chainId: Number(Bun.env.CHAIN_ID), contractAddress: Bun.env.CONTRACT_ADDRESS as `0x${string}`,
    eventSignature: EVENT_SIGNATURE, secret: Bun.env.MULTIBAAS_WEBHOOK_SECRET ?? '',
    deploymentId: Bun.env.MULTIBAAS_DEPLOYMENT_ID ?? '', webhookId: Number(Bun.env.MULTIBAAS_WEBHOOK_ID) });
}

if (import.meta.main) {
  try {
    const config = await configFromEnvironment();
    const store = new WebhookStore(resolve(import.meta.dir, '../.run/webhooks.sqlite'));
    const server = startWebhookServer({ config, store, hostname: Bun.env.WEBHOOK_HOST ?? '127.0.0.1', port: Number(Bun.env.WEBHOOK_PORT ?? 8787) });
    console.log(`Webhook receiver listening on ${server.hostname}:${server.port}; live delivery NOT PROVEN until the demo records it`);
    const stop = () => { server.stop(true); store.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error instanceof WebhookError ? error.code : 'webhook_startup_failed');
    process.exitCode = 1;
  }
}
