import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { handler } from '../../netlify/functions/room';
import { startCourtIqServer, type CourtIqServerInstance } from '../../server/index';

describe('solo-only public release', () => {
  let server: CourtIqServerInstance | null = null;
  afterEach(async () => { await server?.close(); server = null; });

  it('rejects hosted room requests before reading identity or accepting a client feature override', async () => {
    const body = JSON.stringify({ multiplayerEnabled: true, messages: [{
      type: 'CREATE_ROOM', pseudonym: 'DoNotStoreThis', packId: 'spx101-w09-performance-analysis',
      roomPresetId: 'standard', sessionLengthId: 'quick', appearancePreset: 4,
    }] });
    for (const payload of [body, 'not-json']) {
      const response = await handler({ httpMethod: 'POST', body: payload });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).code).toBe('MULTIPLAYER_DISABLED');
      expect(response.body).not.toContain('DoNotStoreThis');
      expect(response.body).not.toContain('ROOM_JOINED');
      expect(response.headers['Cache-Control']).toBe('no-store');
    }
    expect((await handler({ httpMethod: 'OPTIONS' })).statusCode).toBe(204);
  });

  it('defaults the standalone HTTP and WebSocket entry points to unavailable while solo health stays ready', async () => {
    server = await startCourtIqServer({ port: 0 });
    const base = `http://127.0.0.1:${server.port}`;
    const response = await fetch(base + '/api/room', { method: 'POST', body: '{}' });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('MULTIPLAYER_DISABLED');
    const health = await (await fetch(base + '/api/health')).json();
    expect(health.status).toBe('ok');
    expect(health.features.multiplayer).toBe(false);
    expect(health.packs).toHaveLength(2);
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws`);
      ws.on('open', () => { ws.close(); reject(new Error('Disabled multiplayer accepted a socket')); });
      ws.on('error', () => {});
      ws.on('unexpected-response', (_request, result) => {
        result.resume();
        resolve(result.statusCode!);
        ws.terminate();
      });
    });
    expect(status).toBe(503);
  });
});
