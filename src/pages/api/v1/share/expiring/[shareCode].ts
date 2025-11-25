/**
 * DELETE /api/v1/share/expiring/:shareCode - Delete an expiring share
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - No ownership signature required (expiring shares can be deleted by creator of main share)
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion } from '../../../../../lib/crypto';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { shareCode } = params;

    if (!shareCode) {
      return new Response(
        JSON.stringify({ error: 'Share code required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'DELETE',
        path: `/api/v1/share/expiring/${shareCode}`
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({ error: attestResult.error || 'Invalid app attestation' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch expiring share
    const expiringShareData = await kv.get(`expiring:${shareCode}`);

    if (!expiringShareData) {
      return new Response(
        JSON.stringify({ error: 'Expiring share not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const expiringShare = JSON.parse(expiringShareData);

    // Remove from index
    const indexKey = `expiring-index:${expiringShare.mainShareCode}`;
    const existingIndex = await kv.get(indexKey);
    if (existingIndex) {
      const shareCodes = JSON.parse(existingIndex);
      const updatedCodes = shareCodes.filter((code: string) => code !== shareCode);

      if (updatedCodes.length > 0) {
        await kv.put(indexKey, JSON.stringify(updatedCodes));
      } else {
        await kv.delete(indexKey);
      }
    }

    // Delete expiring share
    await kv.delete(`expiring:${shareCode}`);

    return new Response(null, {
      status: 204,
      
    });

  } catch (error) {
    console.error('Error deleting expiring share:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
