import type { APIRoute } from 'astro';

export const prerender = false;

interface ImageManifestEntry {
  filename: string;
  etag: string;
  size: number;
  lastModified: string;
}

interface ImageManifest {
  version: string;
  generatedAt: string;
  images: ImageManifestEntry[];
  totalCount: number;
  totalSize: number;
}

/**
 * GET /api/v1/images/manifest
 *
 * Returns a manifest of all product images with their checksums (ETags).
 * The app uses this to determine which images need to be downloaded/updated.
 *
 * Response format:
 * {
 *   version: "1.0",
 *   generatedAt: "2024-11-13T...",
 *   images: [
 *     { filename: "000NCe.jpg", etag: "abc123...", size: 41605, lastModified: "..." },
 *     ...
 *   ],
 *   totalCount: 7768,
 *   totalSize: 686000000
 * }
 */
export const GET: APIRoute = async ({ locals }) => {
  try {
    const env = (locals.runtime as any)?.env;
    const R2: R2Bucket = env?.PRODUCT_IMAGES;

    if (!R2) {
      return new Response(
        JSON.stringify({
          error: 'R2 bucket not configured',
          message: 'PRODUCT_IMAGES R2 binding is missing'
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // List all objects in the R2 bucket
    const images: ImageManifestEntry[] = [];
    let totalSize = 0;
    let cursor: string | undefined;

    do {
      const listed = await R2.list({ cursor });

      for (const object of listed.objects) {
        images.push({
          filename: object.key,
          etag: object.etag,
          size: object.size,
          lastModified: object.uploaded.toISOString()
        });
        totalSize += object.size;
      }

      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    const manifest: ImageManifest = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      images: images.sort((a, b) => a.filename.localeCompare(b.filename)),
      totalCount: images.length,
      totalSize
    };

    return new Response(
      JSON.stringify(manifest),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
        }
      }
    );
  } catch (error) {
    console.error('Manifest generation failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Manifest generation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
};
