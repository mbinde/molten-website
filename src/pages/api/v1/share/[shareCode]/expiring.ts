/**
 * GET /api/v1/share/:mainShareCode/expiring - List all expiring shares for a main share
 *
 * Response:
 * {
 *   "expiringShares": [
 *     {
 *       "shareCode": "XYZ789",
 *       "displayName": "GAS 2025 Share",
 *       "shareNotes": "Available during conference only",
 *       "expiresAt": "2025-01-20T15:30:00Z",
 *       "createdAt": "2025-01-19T15:30:00Z"
 *     }
 *   ]
 * }
 */

import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const GET: APIRoute = async ({ params, locals }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    const { shareCode: mainShareCode } = params;

    if (!mainShareCode) {
      return new Response(
        JSON.stringify({ error: 'Main share code required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify main share exists
    const mainShare = await kv.get(`share:${mainShareCode}`);
    if (!mainShare) {
      return new Response(
        JSON.stringify({ error: 'Main share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Fetch index of expiring share codes
    const indexKey = `expiring-index:${mainShareCode}`;
    const indexData = await kv.get(indexKey);

    if (!indexData) {
      // No expiring shares
      return new Response(
        JSON.stringify({ expiringShares: [] }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
          }
        }
      );
    }

    const shareCodes: string[] = JSON.parse(indexData);

    // Fetch all expiring shares
    const expiringShares = [];
    for (const code of shareCodes) {
      const shareData = await kv.get(`expiring:${code}`);
      if (shareData) {
        const share = JSON.parse(shareData);

        // Only include non-expired shares
        if (new Date(share.expiresAt) > new Date()) {
          expiringShares.push({
            shareCode: share.shareCode,
            displayName: share.displayName,
            shareNotes: share.shareNotes,
            expiresAt: share.expiresAt,
            createdAt: share.createdAt
          });
        }
      }
    }

    // Sort by expiration date (soonest first)
    expiringShares.sort((a, b) =>
      new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
    );

    return new Response(
      JSON.stringify({ expiringShares }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Error listing expiring shares:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};
