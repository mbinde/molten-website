/**
 * Shared library for converting color palettes to image generation prompts
 */

interface ColorInput {
  hex: string;
  weight?: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Simplified color name mapping (subset of most common colors)
const COLOR_NAMES: Record<string, string> = {
  // Reds
  '#FF0000': 'red', '#8B0000': 'dark red', '#DC143C': 'crimson',
  '#FF6347': 'tomato', '#FF4500': 'orange red', '#FF69B4': 'hot pink',

  // Oranges
  '#FFA500': 'orange', '#FF8C00': 'dark orange', '#FFD700': 'gold',
  '#F5A623': 'amber', '#FF7F50': 'coral',

  // Yellows
  '#FFFF00': 'yellow', '#FFFFE0': 'light yellow', '#FFFACD': 'lemon',
  '#F0E68C': 'khaki',

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
function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Calculate color distance using simple Euclidean distance
 */
function colorDistance(rgb1: RGB, rgb2: RGB): number {
  const rDiff = rgb1.r - rgb2.r;
  const gDiff = rgb1.g - rgb2.g;
  const bDiff = rgb1.b - rgb2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

/**
 * Find nearest color name for a hex code
 */
export function hexToColorName(hex: string): string {
  const targetRgb = hexToRgb(hex.toUpperCase());
  if (!targetRgb) return 'unknown color';

  let nearestName = 'gray';
  let nearestDistance = Infinity;

  for (const [knownHex, name] of Object.entries(COLOR_NAMES)) {
    const knownRgb = hexToRgb(knownHex);
    if (!knownRgb) continue;

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
export function buildColorPrompt(colors: ColorInput[], styleKeywords: string[] = []): string {
  if (!colors || colors.length === 0) {
    return 'abstract colorful design';
  }

  // Sort by weight (highest first)
  const sortedColors = [...colors].sort((a, b) => (b.weight || 1) - (a.weight || 1));

  // Convert to color names
  const colorNames = sortedColors.map(c => hexToColorName(c.hex));

  // Build descriptive prompt
  let prompt = '';

  // Add style keywords if provided
  if (styleKeywords && styleKeywords.length > 0) {
    prompt = styleKeywords.join(' ') + ' ';
  }

  // Add dominant colors
  if (colorNames.length === 1) {
    prompt += `design in ${colorNames[0]}`;
  } else if (colorNames.length === 2) {
    prompt += `design with ${colorNames[0]} and ${colorNames[1]}`;
  } else if (colorNames.length >= 3) {
    const primary = colorNames[0];
    const secondary = colorNames[1];
    const accents = colorNames.slice(2, 4).join(' and ');

    prompt += `design, predominantly ${primary} and ${secondary}`;
    if (accents) {
      prompt += `, with accents of ${accents}`;
    }
  }

  // Add style qualifiers
  prompt += ', flowing, artistic, smooth gradients';

  return prompt;
}
