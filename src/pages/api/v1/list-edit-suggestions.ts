import type { APIRoute } from 'astro';
import { requireAuth } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals.runtime as any)?.env;

    // Verify admin token
    const auth = await requireAuth(env, request);
    if (!auth.authorized) {
      return new Response(JSON.stringify({ error: auth.error || 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const kv = (import.meta as any).env.MOLTEN_STORES;
    if (!kv) {
      throw new Error('KV namespace not available');
    }

    // List all edit suggestions
    const list = await kv.list({ prefix: 'edit_suggestion:' });
    const suggestions = [];

    for (const key of list.keys) {
      const data = await kv.get(key.name);
      if (data) {
        suggestions.push({
          id: key.name,
          ...JSON.parse(data),
        });
      }
    }

    // Sort by submitted_at (newest first)
    suggestions.sort((a, b) => {
      return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
    });

    return new Response(JSON.stringify(suggestions), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing edit suggestions:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
