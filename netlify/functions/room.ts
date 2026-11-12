import { ServerPackService } from '../../server/question-service/packService';
import { MULTIPLAYER_ENABLED, MULTIPLAYER_DISABLED_MESSAGE } from '../../shared/config/features';
import {
  HttpRoomSyncRequest,
  RoomManager,
} from '../../server/rooms/roomManager';

export interface NetlifyLambdaEvent {
  httpMethod: string;
  body?: string | null;
}

export interface NetlifyLambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

/** Explicit opt-in keeps future multiplayer integration tests available; the shipped handler is disabled. */
export function createRoomHandler(options: { multiplayerEnabled?: boolean } = {}) {
  const roomManager = (options.multiplayerEnabled ?? MULTIPLAYER_ENABLED)
    ? new RoomManager(new ServerPackService()) : null;
  return async (event: NetlifyLambdaEvent): Promise<NetlifyLambdaResponse> => {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: CORS_HEADERS,
        body: '',
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
      };
    }

    if (!roomManager) {
      return {
        statusCode: 503,
        headers: CORS_HEADERS,
        body: JSON.stringify({ code: 'MULTIPLAYER_DISABLED', error: MULTIPLAYER_DISABLED_MESSAGE }),
      };
    }

    try {
      const parsed = JSON.parse(event.body || '{}') as HttpRoomSyncRequest;
      const response = roomManager.handleHttpSync(parsed);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify(response),
      };
    } catch (err) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error:
            err instanceof Error ? err.message : 'Invalid request payload',
        }),
      };
    }
  };
}

export const handler = createRoomHandler();
