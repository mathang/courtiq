import { ServerPackService } from '../../server/question-service/packService';
import type { NetlifyLambdaEvent, NetlifyLambdaResponse } from './room';
import { MULTIPLAYER_ENABLED } from '../../shared/config/features';

const packService = new ServerPackService();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

export const handler = async (
  event: NetlifyLambdaEvent
): Promise<NetlifyLambdaResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      status: 'ok',
      service: 'courtiq-netlify-functions',
      features: { multiplayer: MULTIPLAYER_ENABLED },
      packs: packService.listPacks(),
    }),
  };
};
