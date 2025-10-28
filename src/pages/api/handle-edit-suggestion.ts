import type { APIRoute } from 'astro';
import { regenerateStoresJSON } from '../../lib/store-generator';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, suggestionId, adminPassword } = await request.json();

    // Verify admin password
    const expectedPassword = (import.meta as any).env.ADMIN_PASSWORD;
    if (!expectedPassword || adminPassword !== expectedPassword) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const kv = (import.meta as any).env.MOLTEN_STORES;
    if (!kv) {
      throw new Error('KV namespace not available');
    }

    // Get the edit suggestion
    const suggestionData = await kv.get(suggestionId);
    if (!suggestionData) {
      return new Response(JSON.stringify({ error: 'Suggestion not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const suggestion = JSON.parse(suggestionData);

    if (action === 'approve') {
      // Get the existing store
      const storeKey = `approved:${suggestion.store_stable_id}`;
      const storeData = await kv.get(storeKey);

      if (!storeData) {
        return new Response(JSON.stringify({ error: 'Store not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const store = JSON.parse(storeData);

      // Apply the suggested changes
      const updatedStore = {
        ...store,
        ...suggestion.suggested_changes,
        updated_at: new Date().toISOString(),
      };

      // Save updated store
      await kv.put(storeKey, JSON.stringify(updatedStore));

      // Delete the edit suggestion
      await kv.delete(suggestionId);

      // Regenerate stores.json
      await regenerateStoresJSON(kv);

      return new Response(
        JSON.stringify({ message: 'Edit suggestion approved and applied' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else if (action === 'reject') {
      // Just delete the suggestion
      await kv.delete(suggestionId);

      return new Response(
        JSON.stringify({ message: 'Edit suggestion rejected' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error handling edit suggestion:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
