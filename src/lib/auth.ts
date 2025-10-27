import bcrypt from 'bcryptjs';
import jwt from '@tsndr/cloudflare-worker-jwt';

// Validate bcrypt hash format
function isValidBcryptHash(hash: string | undefined): boolean {
  if (!hash || typeof hash !== 'string') return false;

  // Bcrypt hashes must start with $2a$, $2b$, or $2y$ and be at least 59 characters
  // Format: $2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(hash);
}

// Validate credentials are configured (fail closed if not)
function validateCredentialsConfigured(env: any): void {
  const ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH;
  const ADMIN_PASSWORD_PLAIN = env.ADMIN_PASSWORD;
  const JWT_SECRET = env.JWT_SECRET;

  const hasValidHash = isValidBcryptHash(ADMIN_PASSWORD_HASH);
  const hasPlainPassword = ADMIN_PASSWORD_PLAIN && typeof ADMIN_PASSWORD_PLAIN === 'string' && ADMIN_PASSWORD_PLAIN.length > 0;

  if (!hasValidHash && !hasPlainPassword) {
    console.error('🚨 CRITICAL: No admin credentials configured!');
    console.error('   Set ADMIN_PASSWORD_HASH (production) or ADMIN_PASSWORD (dev only)');
    console.error('   Generate hash: node generate-password-hash.js');
  }

  if (!hasValidHash && hasPlainPassword) {
    console.warn('⚠️  WARNING: Using plain ADMIN_PASSWORD (development only)');
    console.warn('   For production, use ADMIN_PASSWORD_HASH instead');
  }

  if (!JWT_SECRET || JWT_SECRET === 'dev-secret-change-in-production') {
    console.warn('⚠️  WARNING: Using default JWT_SECRET (change for production)');
  }
}

interface JWTPayload {
  admin: boolean;
  iat: number;
  exp: number;
}

/**
 * Verify admin password
 * SECURITY: Fails closed - returns false if credentials not properly configured
 */
export async function verifyPassword(env: any, password: string): Promise<boolean> {
  // Validate configuration
  validateCredentialsConfigured(env);

  const ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH;
  const ADMIN_PASSWORD_PLAIN = env.ADMIN_PASSWORD;

  // Reject empty/null/undefined passwords immediately
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    console.error('🚨 AUTH: Rejected empty password attempt');
    return false;
  }

  // Check for valid bcrypt hash first (production)
  if (isValidBcryptHash(ADMIN_PASSWORD_HASH)) {
    try {
      return await bcrypt.compare(password, ADMIN_PASSWORD_HASH!);
    } catch (error) {
      console.error('🚨 AUTH: Bcrypt comparison failed:', error);
      return false;
    }
  }

  // Fall back to plain password comparison (development only)
  if (ADMIN_PASSWORD_PLAIN && typeof ADMIN_PASSWORD_PLAIN === 'string' && ADMIN_PASSWORD_PLAIN.length > 0) {
    // Simple comparison for development
    return password === ADMIN_PASSWORD_PLAIN;
  }

  // FAIL CLOSED: No valid credentials configured
  console.error('🚨 AUTH: No valid credentials configured - login rejected');
  console.error('   ADMIN_PASSWORD_HASH is invalid or missing');
  console.error('   ADMIN_PASSWORD is missing (development fallback)');
  return false;
}

/**
 * Generate JWT token for admin
 * SECURITY: Validates JWT_SECRET is properly configured
 */
export async function generateToken(env: any): Promise<string> {
  const JWT_SECRET = env.JWT_SECRET || 'dev-secret-change-in-production';

  // Validate JWT_SECRET before generating token
  if (!JWT_SECRET || typeof JWT_SECRET !== 'string' || JWT_SECRET.length < 32) {
    console.error('🚨 AUTH: JWT_SECRET is too short or missing - refusing to generate token');
    throw new Error('Invalid JWT_SECRET configuration');
  }

  if (JWT_SECRET === 'dev-secret-change-in-production') {
    console.warn('⚠️  AUTH: Using default JWT_SECRET (insecure for production)');
  }

  try {
    // Cloudflare Workers JWT library API
    const token = await jwt.sign(
      {
        admin: true,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours from now
      },
      JWT_SECRET
    );
    return token;
  } catch (error) {
    console.error('🚨 AUTH: Failed to generate JWT token:', error);
    throw new Error('Token generation failed');
  }
}

/**
 * Verify JWT token
 * SECURITY: Validates JWT_SECRET and token format
 */
export async function verifyToken(env: any, token: string): Promise<JWTPayload | null> {
  const JWT_SECRET = env.JWT_SECRET || 'dev-secret-change-in-production';

  // Reject empty/invalid tokens immediately
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    console.error('🚨 AUTH: Rejected empty/invalid token');
    return null;
  }

  // Validate JWT_SECRET before verifying
  if (!JWT_SECRET || typeof JWT_SECRET !== 'string' || JWT_SECRET.length < 32) {
    console.error('🚨 AUTH: JWT_SECRET invalid - cannot verify tokens');
    return null;
  }

  try {
    // Cloudflare Workers JWT library API
    const isValid = await jwt.verify(token, JWT_SECRET);

    if (!isValid) {
      console.error('🚨 AUTH: Token signature invalid');
      return null;
    }

    // Decode the token to get payload
    const decoded = jwt.decode(token);

    // Validate payload structure
    if (!decoded || !decoded.payload || typeof decoded.payload !== 'object') {
      console.error('🚨 AUTH: Invalid token payload structure');
      return null;
    }

    const payload = decoded.payload as any;

    // Verify admin flag is explicitly true
    if (payload.admin !== true) {
      console.error('🚨 AUTH: Token missing admin flag');
      return null;
    }

    // Return payload with iat and exp
    return {
      admin: payload.admin,
      iat: payload.iat || 0,
      exp: payload.exp || 0
    };
  } catch (error) {
    // Don't log full error (could contain sensitive data)
    if (error instanceof Error) {
      console.error('🚨 AUTH: Token verification failed:', error.message);
    } else {
      console.error('🚨 AUTH: Token verification failed');
    }
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;

  // Support both "Bearer <token>" and just "<token>"
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return authHeader;
}

/**
 * Middleware: Verify request has valid admin token
 */
export async function requireAuth(env: any, request: Request): Promise<{ authorized: boolean; error?: string }> {
  const authHeader = request.headers.get('Authorization');
  const token = extractToken(authHeader);

  if (!token) {
    return { authorized: false, error: 'No authentication token provided' };
  }

  const payload = await verifyToken(env, token);
  if (!payload) {
    return { authorized: false, error: 'Invalid or expired token' };
  }

  return { authorized: true };
}
