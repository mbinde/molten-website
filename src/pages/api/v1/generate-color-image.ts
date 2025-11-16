import type { APIRoute } from 'astro';

interface ColorInput {
  hex: string;
  weight?: number;
}

/**
 * API endpoint for generating images from color palettes
 *
 * POST /api/v1/generate-color-image
 * {
 *   "colors": [
 *     {"hex": "#4A90E2", "weight": 0.4},
 *     {"hex": "#F5A623", "weight": 0.3},
 *     {"hex": "#7ED321", "weight": 0.2}
 *   ],
 *   "style": ["modern", "minimalist"],
 *   "width": 512,
 *   "height": 512
 * }
 */

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();

    // Validate input
    if (!body.colors || !Array.isArray(body.colors) || body.colors.length === 0) {
      return new Response(JSON.stringify({
        error: 'colors array is required (e.g., [{hex: "#4A90E2", weight: 0.4}])'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate hex codes
    for (const color of body.colors) {
      if (!color.hex || !/^#[0-9A-Fa-f]{6}$/.test(color.hex)) {
        return new Response(JSON.stringify({
          error: `Invalid hex color: ${color.hex}. Must be format #RRGGBB`
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Forward to the Worker
    // Note: In production, this would call the deployed Worker
    // For now, we'll include the logic inline or you can deploy the worker separately

    const workerUrl = 'https://generate-color-image.YOUR_SUBDOMAIN.workers.dev';

    // Check if AI binding is available in Cloudflare Pages
    const runtime = locals.runtime;

    if (!runtime?.env?.AI) {
      return new Response(JSON.stringify({
        error: 'Workers AI not available. Please configure AI binding in wrangler.toml',
        hint: 'Add [[ai]] binding = "AI" to wrangler.toml'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Import the worker logic
    const { buildColorPrompt } = await import('../../../lib/color-prompt-builder');

    const colors = body.colors;
    const styleKeywords = body.style || [];
    const width = body.width || 512;
    const height = body.height || 512;
    const model = body.model || 'flux-schnell'; // Default to Flux
    const includeStandardSuffix = body.includeStandardSuffix !== undefined ? body.includeStandardSuffix : true;

    // Build the prompt
    const prompt = buildColorPrompt(colors, styleKeywords, includeStandardSuffix);

    console.log('Generated prompt:', prompt);
    console.log('Using model:', model);

    // Map model selection to Cloudflare model IDs
    const modelMap: Record<string, { id: string; params: any }> = {
      'flux-schnell': {
        id: '@cf/black-forest-labs/flux-1-schnell',
        params: { prompt, num_steps: 4, width, height }
      },
      'sdxl-lightning': {
        id: '@cf/bytedance/stable-diffusion-xl-lightning',
        params: { prompt, num_steps: 4, width, height, guidance: 7.5 }
      },
      'sdxl-base': {
        id: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        params: { prompt, num_steps: 20, width, height, guidance: 7.5 }
      }
    };

    const selectedModel = modelMap[model] || modelMap['flux-schnell'];
    const modelName = selectedModel.id;

    // Call Cloudflare Workers AI
    const ai = runtime.env.AI;
    const imageResponse = await ai.run(modelName, selectedModel.params);

    // Return the generated image
    return new Response(imageResponse, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-Generated-Prompt': prompt,
        'X-Model-Name': modelName,
      },
    });

  } catch (error) {
    console.error('Error generating image:', error);

    return new Response(JSON.stringify({
      error: 'Failed to generate image',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
};
