# Color Palette Image Generation

Generate abstract background images from glass color palettes using Cloudflare Workers AI and Stable Diffusion.

## Overview

This feature converts hex color codes (from your glass inventory) into AI-generated background images. It's perfect for:
- Creating themed backgrounds based on project colors
- Generating banners with specific color schemes
- Visualizing color combinations before starting a project

## How It Works

1. **Color Conversion**: Hex codes are converted to descriptive color names using nearest-neighbor matching
2. **Weighted Prompts**: Colors are weighted by importance in the final prompt
3. **Style Keywords**: Additional keywords like "modern", "spooky", or "christmas" guide the aesthetic
4. **Image Generation**: Cloudflare Workers AI (Stable Diffusion XL) generates the image

## API Endpoint

### POST `/api/v1/generate-color-image`

**Request Body:**
```json
{
  "colors": [
    {"hex": "#4A90E2", "weight": 0.4},
    {"hex": "#F5A623", "weight": 0.3},
    {"hex": "#7ED321", "weight": 0.2}
  ],
  "style": ["modern", "minimalist"],
  "width": 512,
  "height": 512
}
```

**Parameters:**
- `colors` (required): Array of color objects
  - `hex` (required): 6-digit hex code (e.g., "#4A90E2")
  - `weight` (optional): Relative importance (0.0-1.0, default: 1.0)
- `style` (optional): Array of style keywords (e.g., ["modern", "spooky", "christmas"])
- `width` (optional): Image width in pixels (default: 512, max: 2048)
- `height` (optional): Image height in pixels (default: 512, max: 2048)

**Response:**
- Content-Type: `image/png`
- Binary PNG image data
- Headers:
  - `X-Generated-Prompt`: The text prompt used for generation (useful for debugging)
  - `Cache-Control`: Images are cached for 24 hours

**Example Curl:**
```bash
curl -X POST https://moltenglass.app/api/v1/generate-color-image \
  -H "Content-Type: application/json" \
  -d '{
    "colors": [
      {"hex": "#4A90E2", "weight": 0.4},
      {"hex": "#F5A623", "weight": 0.3}
    ],
    "style": ["modern"]
  }' \
  --output background.png
```

## Color Name Mapping

The system includes a curated set of ~50 common colors. When you provide a hex code, it finds the nearest match and uses a descriptive name. Examples:

- `#4A90E2` → "cerulean blue"
- `#F5A623` → "amber"
- `#7ED321` → "lime green"
- `#DC143C` → "crimson"
- `#FAFAFA` → "clear" (special glass color)

## Use Cases & Examples

### 1. Modern Glass Project
```json
{
  "colors": [
    {"hex": "#4A90E2", "weight": 0.5},
    {"hex": "#FFFFFF", "weight": 0.3},
    {"hex": "#C0C0C0", "weight": 0.2}
  ],
  "style": ["modern", "minimalist", "clean"]
}
```

### 2. Halloween/Spooky Theme
```json
{
  "colors": [
    {"hex": "#FF8C00", "weight": 0.4},
    {"hex": "#800080", "weight": 0.3},
    {"hex": "#000000", "weight": 0.3}
  ],
  "style": ["spooky", "dark", "halloween"]
}
```

### 3. Christmas Theme
```json
{
  "colors": [
    {"hex": "#DC143C", "weight": 0.4},
    {"hex": "#006400", "weight": 0.4},
    {"hex": "#FFD700", "weight": 0.2}
  ],
  "style": ["festive", "christmas", "elegant"]
}
```

### 4. Warm Sunset Colors
```json
{
  "colors": [
    {"hex": "#FF6347", "weight": 0.4},
    {"hex": "#FFA500", "weight": 0.3},
    {"hex": "#FFD700", "weight": 0.2},
    {"hex": "#8B4513", "weight": 0.1}
  ],
  "style": ["warm", "sunset", "gradient"]
}
```

## Swift Integration

### Basic Example
```swift
import Foundation

struct ColorImageRequest: Codable {
    struct Color: Codable {
        let hex: String
        let weight: Double?
    }

    let colors: [Color]
    let style: [String]?
    let width: Int?
    let height: Int?
}

func generateColorImage(colors: [(hex: String, weight: Double)], style: [String] = []) async throws -> Data {
    let url = URL(string: "https://moltenglass.app/api/v1/generate-color-image")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let requestBody = ColorImageRequest(
        colors: colors.map { ColorImageRequest.Color(hex: $0.hex, weight: $0.weight) },
        style: style.isEmpty ? nil : style,
        width: 512,
        height: 512
    )

    request.httpBody = try JSONEncoder().encode(requestBody)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw URLError(.badServerResponse)
    }

    return data
}

// Usage
Task {
    let colors = [
        ("#4A90E2", 0.5),
        ("#F5A623", 0.3),
        ("#7ED321", 0.2)
    ]

    let imageData = try await generateColorImage(
        colors: colors,
        style: ["modern", "minimalist"]
    )

    // On iOS
    let image = UIImage(data: imageData)

    // On macOS
    let image = NSImage(data: imageData)
}
```

### Service Integration (Following Molten Architecture)

Create a new service at `Molten/Sources/Services/ColorImageService.swift`:

```swift
import Foundation

protocol ColorImageServiceProtocol {
    func generateImage(from colors: [(hex: String, weight: Double)], style: [String]) async throws -> Data
}

struct ColorImageService: ColorImageServiceProtocol {
    private let baseURL = "https://moltenglass.app"

    func generateImage(from colors: [(hex: String, weight: Double)], style: [String] = []) async throws -> Data {
        let endpoint = URL(string: "\(baseURL)/api/v1/generate-color-image")!
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let requestBody: [String: Any] = [
            "colors": colors.map { ["hex": $0.hex, "weight": $0.weight] },
            "style": style,
            "width": 512,
            "height": 512
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return data
    }
}

// Add to AppDependencies.swift:
extension AppDependencies {
    var colorImageService: ColorImageServiceProtocol {
        ColorImageService()
    }
}
```

## Local Development

### 1. Install Dependencies
```bash
cd /Users/binde/molten-website
npm install
```

### 2. Run Development Server
```bash
npm run dev
```

The API will be available at `http://localhost:4321/api/v1/generate-color-image`

### 3. Test with Sample Data
```bash
./test-color-image.sh
```

This generates three test images:
- `test-modern.png` - Modern style with blue/amber/green
- `test-spooky.png` - Halloween colors
- `test-christmas.png` - Red/green/gold Christmas theme

## Deployment

### Automatic Deployment (Cloudflare Pages)

The API endpoint is part of the Astro site and deploys automatically when you push to git:

```bash
git add .
git commit -m "feat: add color image generation API"
git push
```

Cloudflare Pages will:
1. Build the Astro site
2. Deploy to `moltenglass.app`
3. Make the API available at `https://moltenglass.app/api/v1/generate-color-image`

### Manual Worker Deployment (Optional)

If you want to deploy the standalone Worker:

```bash
cd /Users/binde/molten-website
npx wrangler deploy workers/generate-color-image.js --name generate-color-image
```

This creates a separate Worker at `https://generate-color-image.YOUR_SUBDOMAIN.workers.dev`

## Configuration

The Workers AI binding is configured in `wrangler.toml`:

```toml
[ai]
binding = "AI"
```

This binding is automatically available in Cloudflare Pages and Workers.

## Pricing

**Cloudflare Workers AI:**
- Free tier: 10,000 Neurons/day
- Image generation: ~10-50 Neurons per image
- **~200-1000 free images per day**
- Paid tier: $0.011 per 1,000 Neurons (extremely cheap)

**Example costs:**
- 100 images/day: FREE (well within free tier)
- 1,000 images/day: FREE (within free tier)
- 10,000 images/day: ~$1-5/day

For a "fun frivolous feature", the free tier is more than enough!

## Limitations

### Color Accuracy
- Colors are interpreted through text prompts, not precise hex values
- Stable Diffusion will approximate colors (e.g., "#4A90E2" becomes "cerulean blue")
- Results may vary - same prompt can generate different images
- Best for decorative backgrounds, not color-accurate mockups

### Performance
- Generation takes 3-10 seconds per image
- Images are cached for 24 hours
- Free tier has rate limits (10,000 Neurons/day)

### Image Size
- Max dimensions: 2048x2048 pixels
- Recommended: 512x512 for fast generation
- Larger images use more Neurons and take longer

## Troubleshooting

### "Workers AI not configured"
Make sure `wrangler.toml` has the AI binding:
```toml
[ai]
binding = "AI"
```

### "Invalid hex color"
Hex codes must be 6 digits with # prefix: `#RRGGBB`
- ✅ `#4A90E2`
- ❌ `4A90E2` (missing #)
- ❌ `#4A9` (too short)

### Colors don't match exactly
This is expected - Stable Diffusion interprets colors through text descriptions, not hex values. For precise color control, you'd need ControlNet (more complex, not free).

### Images look different each time
Stable Diffusion is non-deterministic by default. To get reproducible results, add a `seed` parameter (future enhancement).

## Future Enhancements

Possible improvements:
1. **Add seed parameter** for reproducible images
2. **Expand color dictionary** to 30,000+ colors using npm package
3. **Add negative prompts** to exclude unwanted elements
4. **Support img2img** to refine existing images
5. **Add ControlNet** for precise color control (requires more complex setup)
6. **Cache by color palette** to reuse identical requests

## Credits

- **Cloudflare Workers AI** - Stable Diffusion XL hosting
- **Stable Diffusion XL** - Image generation model
- Color matching algorithm based on Euclidean RGB distance
