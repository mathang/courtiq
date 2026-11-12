import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ClientToServerMessage, ServerToClientMessage } from '../shared/protocol/messages';
import { ServerPackService } from './question-service/packService';
import { RoomManager } from './rooms/roomManager';
import { MULTIPLAYER_ENABLED, MULTIPLAYER_DISABLED_MESSAGE } from '../shared/config/features';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export interface CourtIqServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
  roomManager: RoomManager;
  packService: ServerPackService;
  port: number;
  close: () => Promise<void>;
}

export async function startCourtIqServer(options?: {
  port?: number;
  tickIntervalMs?: number;
  defaultSeed?: number;
  /** Development/tests may explicitly opt into the retained future feature. */
  multiplayerEnabled?: boolean;
}): Promise<CourtIqServerInstance> {
  const multiplayerEnabled = options?.multiplayerEnabled ?? MULTIPLAYER_ENABLED;
  const packService = new ServerPackService();
  const roomManager = new RoomManager(packService, {
    defaultSeed: options?.defaultSeed,
  });

  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'courtiq-authoritative-server',
          features: { multiplayer: multiplayerEnabled },
          packs: packService.listPacks(),
        })
      );
      return;
    }

    if (req.url === '/api/packs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ packs: packService.listPacks() }));
      return;
    }

    if (req.url === '/api/room' && req.method === 'POST') {
      if (!multiplayerEnabled) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ code: 'MULTIPLAYER_DISABLED', error: MULTIPLAYER_DISABLED_MESSAGE }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const syncRes = roomManager.handleHttpSync(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(syncRes));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON body' }));
        }
      });
      return;
    }

    // Serve built static frontend from dist/ if available
    if (req.method === 'GET' && fs.existsSync(DIST_DIR)) {
      const cleanUrl = (req.url || '/').split('?')[0];
      const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const candidate = path.resolve(DIST_DIR, relPath);
      if (
        candidate.startsWith(DIST_DIR) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        const ext = path.extname(candidate);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        });
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const wss = new WebSocketServer({
    server: httpServer, path: '/ws',
    verifyClient: (_info, done) => {
      if (multiplayerEnabled) done(true);
      else done(false, 503, MULTIPLAYER_DISABLED_MESSAGE);
    },
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (msg: ServerToClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.on('message', (rawData) => {
      try {
        const parsed = JSON.parse(String(rawData)) as ClientToServerMessage;
        roomManager.handleMessage(ws, send, parsed);
      } catch {
        send({ type: 'ERROR', message: 'Malformed JSON message.' });
      }
    });

    ws.on('close', () => {
      roomManager.handleDisconnect(ws);
    });
  });

  const tickMs = options?.tickIntervalMs ?? 50;
  let lastTick = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;
    roomManager.tickAllRooms(delta);
  }, tickMs);

  const requestedPort = options?.port ?? Number(process.env.PORT || 8787);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, () => resolve());
  });

  const addr = httpServer.address();
  const actualPort =
    typeof addr === 'object' && addr !== null ? addr.port : requestedPort;

  const close = async () => {
    clearInterval(timer);
    for (const client of wss.clients) {
      client.close();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return {
    httpServer,
    wss,
    roomManager,
    packService,
    port: actualPort,
    close,
  };
}

// Run standalone when invoked directly via `npm run server`
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('server/index.ts')
) {
  startCourtIqServer().then((srv) => {
    console.log(
      `[CourtIQ Authoritative Server] Listening on http://localhost:${srv.port} (WS: ws://localhost:${srv.port}/ws)`
    );
  });
}
