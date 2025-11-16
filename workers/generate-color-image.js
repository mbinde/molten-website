/**
 * Cloudflare Worker for generating images based on color palettes
 *
 * Converts hex codes to color names and uses Cloudflare Workers AI
 * to generate abstract background images with Stable Diffusion
 *
 * Deploy with:
 * npx wrangler deploy workers/generate-color-image.js --name generate-color-image
 */

// Simplified color name mapping (subset of most common colors)
// In production, you could use a full color-name library
const COLOR_NAMES = {
  // Reds
  '#FF0000': 'red', '#8B0000': 'dark red', '#DC143C': 'crimson',
  '#FF6347': 'tomato', '#FF4500': 'orange red', '#FF69B4': 'hot pink',

  // Oranges
  '#FFA500': 'orange', '#FF8C00': 'dark orange', '#FFD700': 'gold',
  '#F5A623': 'amber', '#FF7F50': 'coral',

  // Yellows
  '#FFFF00': 'yellow', '#FFFFE0': 'light yellow', '#FFFACD': 'lemon',
  '#F0E68C': 'khaki', '#FFD700': 'golden',

  // Greens
  '#00FF00': 'lime', '#008000': 'green', '#006400': 'dark green',
  '#90EE90': 'light green', '#7ED321': 'lime green', '#50E3C2': 'turquoise',
  '#00CED1': 'dark turquoise', '#20B2AA': 'light sea green',

  // Blues
  '#0000FF': 'blue', '#000080': 'navy', '#4169E1': 'royal blue',
  '#87CEEB': 'sky blue', '#4A90E2': 'cerulean blue', '#1E90FF': 'dodger blue',
  '#00BFFF': 'deep sky blue', '#5F9EA0': 'cadet blue', '#B0E0E6': 'powder blue',

  // Purples
  '#800080': 'purple', '#9370DB': 'medium purple', '#8A2BE2': 'blue violet',
  '#9932CC': 'dark orchid', '#BA55D3': 'medium orchid', '#DDA0DD': 'plum',

  // Browns
  '#A52A2A': 'brown', '#8B4513': 'saddle brown', '#D2691E': 'chocolate',
  '#CD853F': 'peru', '#F4A460': 'sandy brown', '#DEB887': 'burlywood',

  // Grayscale
  '#FFFFFF': 'white', '#000000': 'black', '#808080': 'gray',
  '#C0C0C0': 'silver', '#696969': 'dim gray', '#A9A9A9': 'dark gray',
  '#D3D3D3': 'light gray',

  // Special glass colors
  '#FAFAFA': 'clear', '#F5F5F5': 'crystal clear', '#E8E8E8': 'opal white',
};

/**
 * Convert hex to RGB
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Calculate color distance using simple Euclidean distance
 * For better results, could use CIEDE2000, but this is fast and good enough
 */
function colorDistance(rgb1, rgb2) {
  const rDiff = rgb1.r - rgb2.r;
  const gDiff = rgb1.g - rgb2.g;
  const bDiff = rgb1.b - rgb2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

/**
 * Find nearest color name for a hex code
 */
function hexToColorName(hex) {
  const targetRgb = hexToRgb(hex.toUpperCase());
  if (!targetRgb) return 'unknown color';

  let nearestName = 'gray';
  let nearestDistance = Infinity;

  for (const [knownHex, name] of Object.entries(COLOR_NAMES)) {
    const knownRgb = hexToRgb(knownHex);
    const distance = colorDistance(targetRgb, knownRgb);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestName = name;
    }
  }

  return nearestName;
}

/**
 * Build a weighted prompt from color palette
 */
function buildColorPrompt(colors, styleKeywords = []) {
  if (!colors || colors.length === 0) {
    return 'abstract colorful design';
  }

  // Calculate total weight
  const totalWeight = colors.reduce((sum, c) => sum + (c.weight || 1), 0);

  // Convert to color names and combine duplicates
  const colorMap = new Map();

  for (const color of colors) {
    const name = hexToColorName(color.hex);
    const weight = color.weight || 1;
    colorMap.set(name, (colorMap.get(name) || 0) + weight);
  }

  // Convert to array with percentages and sort by weight (highest first)
  const colorData = Array.from(colorMap.entries())
    .map(([name, weight]) => ({
      name,
      percentage: Math.round((weight / totalWeight) * 100)
    }))
    .sort((a, b) => b.percentage - a.percentage);

  // Build descriptive prompt
  let prompt = '';

  // Add style keywords if provided
  if (styleKeywords && styleKeywords.length > 0) {
    prompt = styleKeywords.join(' ') + ' ';
  }

  // Add connecting phrase
  prompt += ' with the image made up of ';

  // Categorize colors by distribution
  const percentages = colorData.map(c => c.percentage);
  const max = Math.max(...percentages);
  const min = Math.min(...percentages);
  const range = max - min;

  // If distribution is relatively even (range <= 15%), just list them
  if (range <= 15) {
    if (colorData.length === 1) {
      prompt += `${colorData[0].name}`;
    } else if (colorData.length === 2) {
      prompt += `${colorData[0].name} and ${colorData[1].name}`;
    } else {
      const colorNames = colorData.map(c => c.name);
      const lastColor = colorNames[colorNames.length - 1];
      const otherColors = colorNames.slice(0, -1).join(', ');
      prompt += `${otherColors}, and ${lastColor}`;
    }
  } else {
    // Categorize by percentage bands
    const categories = {
      primarily: [],   // 40%+
      mostly: [],      // 20-39%
      some: [],        // 10-19%
      touches: []      // <10%
    };

    colorData.forEach(c => {
      if (c.percentage >= 40) categories.primarily.push(c.name);
      else if (c.percentage >= 20) categories.mostly.push(c.name);
      else if (c.percentage >= 10) categories.some.push(c.name);
      else categories.touches.push(c.name);
    });

    // Build categorized description
    const parts = [];

    if (categories.primarily.length > 0) {
      if (categories.primarily.length === 1) {
        parts.push(`primarily ${categories.primarily[0]}`);
      } else {
        parts.push(`primarily ${categories.primarily.join(' and ')}`);
      }
    }

    if (categories.mostly.length > 0) {
      if (categories.mostly.length === 1) {
        parts.push(`mostly ${categories.mostly[0]}`);
      } else {
        const last = categories.mostly[categories.mostly.length - 1];
        const others = categories.mostly.slice(0, -1).join(', ');
        parts.push(`mostly ${others} and ${last}`);
      }
    }

    if (categories.some.length > 0) {
      if (categories.some.length === 1) {
        parts.push(`some ${categories.some[0]}`);
      } else {
        const last = categories.some[categories.some.length - 1];
        const others = categories.some.slice(0, -1).join(', ');
        parts.push(`some ${others} and ${last}`);
      }
    }

    if (categories.touches.length > 0) {
      if (categories.touches.length === 1) {
        parts.push(`hints of ${categories.touches[0]}`);
      } else {
        const last = categories.touches[categories.touches.length - 1];
        const others = categories.touches.slice(0, -1).join(', ');
        parts.push(`hints of ${others} and ${last}`);
      }
    }

    prompt += parts.join(', ');
  }

  // Add style qualifiers
  prompt += ', flowing, artistic, smooth gradients';

  return prompt;
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

      // Validate colors
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

      // Extract parameters
      const colors = body.colors; // [{hex: "#4A90E2", weight: 0.4}, ...]
      const styleKeywords = body.style || []; // ["modern", "minimalist"]
      const width = body.width || 512;
      const height = body.height || 512;

      // Build the prompt
      const prompt = buildColorPrompt(colors, styleKeywords);

      console.log('Generated prompt:', prompt);
      console.log('Colors:', colors.map(c => `${c.hex} (${hexToColorName(c.hex)})`).join(', '));

      // Call Cloudflare Workers AI
      const ai = env.AI;

      if (!ai) {
        return new Response(JSON.stringify({
          error: 'Workers AI not configured. Add AI binding to wrangler.toml'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const imageResponse = await ai.run(
        '@cf/bytedance/stable-diffusion-xl-lightning',
        {
          prompt: prompt,
          num_steps: 4, // Lightning model works well with fewer steps
          width: width,
          height: height,
          guidance: 7.5,
        }
      );

      // Return the generated image
      return new Response(imageResponse, {
        headers: {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
          'X-Generated-Prompt': prompt, // Debug header
        },
      });

    } catch (error) {
      console.error('Error generating image:', error);

      return new Response(JSON.stringify({
        error: 'Failed to generate image',
        details: error.message
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
