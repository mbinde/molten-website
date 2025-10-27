import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '../../lib/auth';

interface PendingStore {
  stable_id: string;
  name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  website_url?: string;
  notes?: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  submitter?: {
    name?: string;
    email?: string;
  };
  rejected_at?: string;
}

interface PendingStoresData {
  version: string;
  submissions: PendingStore[];
}

async function loadPendingStores(filePath: string): Promise<PendingStoresData> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function savePendingStores(filePath: string, data: PendingStoresData): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export const POST: APIRoute = async ({ request }) => {
  // Check authentication
  const auth = requireAuth(request);
  if (!auth.authorized) {
    return new Response(
      JSON.stringify({ error: auth.error || 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { stable_id } = body;

    if (!stable_id) {
      return new Response(
        JSON.stringify({ error: 'stable_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dataPath = path.join(process.cwd(), 'public', 'data', 'pending-stores.json');
    const pendingData = await loadPendingStores(dataPath);

    const storeIndex = pendingData.submissions.findIndex(
      s => s.stable_id === stable_id
    );

    if (storeIndex === -1) {
      return new Response(
        JSON.stringify({ error: 'Store not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update status to rejected
    pendingData.submissions[storeIndex].status = 'rejected';
    pendingData.submissions[storeIndex].rejected_at = new Date().toISOString();

    await savePendingStores(dataPath, pendingData);

    return new Response(
      JSON.stringify({
        message: 'Store rejected successfully',
        stable_id
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error rejecting store:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
