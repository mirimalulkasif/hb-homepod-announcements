import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Announcer } from './announcer';

export interface AnnounceHttpOptions {
  port: number;
  announcer: Announcer;
  defaultHomepodId?: string;
  defaultVolume?: number;
  defaultVoice?: string;
  log?: (message: string) => void;
}

/**
 * Optional LAN endpoint so other automations (laundry Done, webhooks) can
 * speak arbitrary text without a dedicated HomeKit switch.
 *
 * POST /announce  { "text": "Dryer is done", "homepodId"?: "...", "volume"?: 50 }
 * GET  /health
 */
export class AnnounceHttpServer {
  private server?: Server;
  private readonly log: (message: string) => void;

  constructor(private readonly options: AnnounceHttpOptions) {
    this.log = options.log || (() => undefined);
  }

  start(): void {
    if (this.server || this.options.port <= 0) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.listen(this.options.port, '0.0.0.0', () => {
      this.log(`HTTP announce listening on :${this.options.port} (POST /announce)`);
    });
    this.server.on('error', (error) => {
      this.log(`HTTP server error: ${error.message}`);
    });
  }

  stop(): void {
    const server = this.server;
    this.server = undefined;
    server?.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/announce') {
      try {
        const body = await readJson(req);
        const text = String(body.text ?? '').trim();
        if (!text) {
          json(res, 400, { error: 'text is required' });
          return;
        }
        await this.options.announcer.speak({
          text,
          homepodId: typeof body.homepodId === 'string' ? body.homepodId : this.options.defaultHomepodId,
          volume: typeof body.volume === 'number' ? body.volume : this.options.defaultVolume,
          voice: typeof body.voice === 'string' ? body.voice : this.options.defaultVoice,
        });
        json(res, 200, { ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`HTTP /announce failed: ${message}`);
        json(res, 500, { error: message });
      }
      return;
    }
    json(res, 404, { error: 'not found' });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object');
  }
  return parsed as Record<string, unknown>;
}
