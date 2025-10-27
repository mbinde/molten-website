import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// JWT secret from environment (MUST be set in production)
const JWT_SECRET = import.meta.env.JWT_SECRET || 'dev-secret-change-in-production';

// Admin password hash from environment
// Generate with: node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
const ADMIN_PASSWORD_HASH = import.meta.env.ADMIN_PASSWORD_HASH;

// Plain password fallback for development only
const ADMIN_PASSWORD_PLAIN = import.meta.env.ADMIN_PASSWORD;

interface JWTPayload {
  admin: boolean;
  iat: number;
  exp: number;
}

/**
 * Verify admin password
 */
export async function verifyPassword(password: string): Promise<boolean> {
  // If we have a hash, use bcrypt (production)
  if (ADMIN_PASSWORD_HASH) {
    return await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  }

  // Otherwise, fall back to plain password comparison (development only)
  if (ADMIN_PASSWORD_PLAIN) {
    return password === ADMIN_PASSWORD_PLAIN;
  }

  // No password configured
  console.error('ERROR: No ADMIN_PASSWORD_HASH or ADMIN_PASSWORD configured!');
  return false;
}

/**
 * Generate JWT token for admin
 */
export function generateToken(): string {
  return jwt.sign(
    { admin: true },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    if (decoded.admin === true) {
      return decoded;
    }
    return null;
  } catch (error) {
    console.error('Token verification failed:', error);
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
export function requireAuth(request: Request): { authorized: boolean; error?: string } {
  const authHeader = request.headers.get('Authorization');
  const token = extractToken(authHeader);

  if (!token) {
    return { authorized: false, error: 'No authentication token provided' };
  }

  const payload = verifyToken(token);
  if (!payload) {
    return { authorized: false, error: 'Invalid or expired token' };
  }

  return { authorized: true };
}
