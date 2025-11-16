/**
 * POST /api/v1/submit-image - Submit manufacturer image for consideration
 *
 * Request Body:
 * {
 *   "glassItem": {
 *     "stable_id": "bullseye-0001-0",
 *     "name": "Bullseye Red Opal",
 *     "manufacturer": "be",
 *     "code": "0001"
 *   },
 *   "email": "user@example.com",
 *   "image": "base64-encoded-image-data",
 *   "hasPermission": true,
 *   "offersFreeOfCharge": true
 * }
 *
 * Security:
 * - App Attest assertion in X-Apple-Assertion header (iOS 14+)
 * - Rate limiting: 1000 submissions per day per device
 * - Email validation
 * - Image size limits (max 5MB)
 * - Terms acceptance required
 */

import type { APIRoute } from 'astro';
import { verifyAppAttestAssertion, checkRateLimit } from '../../../lib/crypto';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Apple-Assertion',
};

const MAX_IMAGE_SIZE_MB = 5;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const DAILY_SUBMISSION_LIMIT = 1000;

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = (locals.runtime as any)?.env;
  const kv = env?.INVENTORY_SHARES; // Reuse existing KV namespace

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'Storage not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  try {
    // Rate limiting: 1000 submissions per day per IP
    const rateLimitKey = `ratelimit:${clientAddress}:submit-image`;
    const rateLimit = await checkRateLimit(env, rateLimitKey, DAILY_SUBMISSION_LIMIT, 24 * 60);

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Daily submission limit exceeded (1000 images per day)',
          resetAt: rateLimit.resetAt.toISOString()
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimit.resetAt.toISOString(),
            ...CORS_HEADERS
          }
        }
      );
    }

    // Parse request body
    const body = await request.json();
    const { glassItem, email, image, hasPermission, offersFreeOfCharge } = body;

    // Validate required fields
    if (!glassItem || !email || !image || hasPermission !== true || offersFreeOfCharge !== true) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required fields or terms not accepted'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate glass item fields
    if (!glassItem.stable_id || !glassItem.name || !glassItem.manufacturer || !glassItem.code) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid glass item data'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate email format
    const emailRegex = /^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,64}$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid email address'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Validate image is base64
    if (typeof image !== 'string' || !image.match(/^[A-Za-z0-9+/]+=*$/)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid image format (must be base64)'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Calculate image size
    const imageSizeBytes = (image.length * 3) / 4; // Rough base64 size calculation
    if (imageSizeBytes > MAX_IMAGE_SIZE_BYTES) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`
        }),
        { status: 413, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Verify App Attest assertion
    const assertion = request.headers.get('X-Apple-Assertion');
    const bodyHash = await hashBody(JSON.stringify(body));
    const attestResult = await verifyAppAttestAssertion(
      assertion,
      {
        method: 'POST',
        path: '/api/v1/submit-image',
        bodyHash
      },
      env
    );

    if (!attestResult.valid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: attestResult.error || 'Invalid app attestation'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Generate submission ID
    const submissionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Create submission object
    const submission = {
      id: submissionId,
      glassItem: {
        stable_id: glassItem.stable_id,
        name: glassItem.name,
        manufacturer: glassItem.manufacturer,
        code: glassItem.code
      },
      email,
      image, // Store base64 image
      hasPermission: true,
      offersFreeOfCharge: true,
      submittedAt: timestamp,
      submittedFrom: clientAddress,
      reviewed: false
    };

    // Store submission in KV (expires after 90 days)
    await kv.put(
      `image-submission:${submissionId}`,
      JSON.stringify(submission),
      {
        expirationTtl: 90 * 24 * 60 * 60 // 90 days
      }
    );

    // Send notification email (if configured)
    await sendSubmissionNotification(env, submission);

    console.log(`✅ Image submission received: ${submissionId} for ${glassItem.stable_id} from ${email}`);

    return new Response(
      JSON.stringify({
        success: true,
        submissionId
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': rateLimit.remaining.toString(),
          ...CORS_HEADERS
        }
      }
    );

  } catch (error) {
    console.error('Image submission error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
};

/**
 * Hash request body for App Attest verification
 */
async function hashBody(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode.apply(null, hashArray as any));
  return hashBase64;
}

/**
 * Send email notification about new submission
 * TODO: Implement with email service (Resend, SendGrid, etc.)
 */
async function sendSubmissionNotification(env: any, submission: any): Promise<void> {
  // For MVP, just log the submission
  // In production, send email via Resend/SendGrid
  console.log('📧 Email notification (not implemented):', {
    to: 'admin@moltenapp.com', // Replace with actual admin email
    subject: `New Image Submission: ${submission.glassItem.name}`,
    submissionId: submission.id,
    from: submission.email,
    glassItem: submission.glassItem.stable_id
  });

  // TODO: Implement actual email sending
  // Example with Resend:
  // if (env.RESEND_API_KEY) {
  //   await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': `Bearer ${env.RESEND_API_KEY}`,
  //       'Content-Type': 'application/json'
  //     },
  //     body: JSON.stringify({
  //       from: 'noreply@moltenapp.com',
  //       to: 'admin@moltenapp.com',
  //       subject: `New Image Submission: ${submission.glassItem.name}`,
  //       html: `
  //         <h2>New Image Submission</h2>
  //         <p><strong>Glass Item:</strong> ${submission.glassItem.stable_id} - ${submission.glassItem.name}</p>
  //         <p><strong>Manufacturer:</strong> ${submission.glassItem.manufacturer}</p>
  //         <p><strong>Submitted by:</strong> ${submission.email}</p>
  //         <p><strong>Submission ID:</strong> ${submission.id}</p>
  //         <p><strong>Timestamp:</strong> ${submission.submittedAt}</p>
  //       `
  //     })
  //   });
  // }
}
