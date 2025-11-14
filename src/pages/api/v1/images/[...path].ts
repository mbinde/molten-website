import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * GET /api/v1/images/{filename}
 *
 * Serves product images from R2 storage with proper caching headers.
 * Supports conditional requests via ETag for efficient updates.
 *
 * Examples:
 * - /api/v1/images/000NCe.jpg
 * - /api/v1/images/000NCe_thumb.jpg
 *
 * Headers:
 * - ETag: The R2 object's etag (for checksum validation)
 * - Cache-Control: Long-term caching (images are immutable by filename)
 * - If-None-Match: Client can send this for conditional requests
 */
export const GET: APIRoute = async ({ params, request, locals }) => {
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
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Get the filename from the path parameter
    const path = params.path;
    if (!path) {
      return new Response('Not found', { status: 404 });
    }

    // Get the image from R2
    const object = await R2.get(path);

    if (!object) {
      return new Response('Image not found', { status: 404 });
    }

    // Check for conditional request (If-None-Match)
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: {
          'ETag': object.httpEtag,
          'Cache-Control': 'public, max-age=31536000, immutable' // 1 year
        }
      });
    }

    // Determine content type from filename
    const contentType = getContentType(path);

    // Return the image with proper headers
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'ETag': object.httpEtag,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year - images don't change
        'Access-Control-Allow-Origin': '*',
        'Content-Length': object.size.toString(),
        'Last-Modified': object.uploaded.toUTCString()
      }
    });
  } catch (error) {
    console.error('Image serving failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Image serving failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
};

/**
 * Determine content type from filename extension
 */
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
