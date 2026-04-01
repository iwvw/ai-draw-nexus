import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DEV_SECRET_FILE = path.join(process.cwd(), '.dev.secret');

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production mode.');
  }
  
  // Try to load from file first for stability across restarts
  try {
    if (fs.existsSync(DEV_SECRET_FILE)) {
      return fs.readFileSync(DEV_SECRET_FILE, 'utf-8').trim();
    }
  } catch (e) {}

  // Generate and persist if not found
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(DEV_SECRET_FILE, secret);
  } catch (e) {}
  
  return secret;
}

// Zod Schemas for Authentication
export const LoginSchema = z.object({
  username: z.string().min(1, "Username is required").max(50),
  password: z.string().min(1, "Password is required").max(100)
});

export const RegisterSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  name: z.string().max(50).optional()
});

export async function hashPassword(password: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  hash.update(password);
  return hash.digest('hex');
}

export async function generateToken(payload: any): Promise<string> {
  const secret = getJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7 // 7 days
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  
  const tokenData = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(tokenData).digest('base64url');
  
  return `${tokenData}.${signature}`;
}

export async function verifyToken(token: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const secret = getJwtSecret();
    const validSignature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

    if (signature !== validSignature) return null;

    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    
    if (decodedPayload.exp && decodedPayload.exp < now) {
      return null;
    }

    return decodedPayload;
  } catch (e) {
    return null;
  }
}

// Middleware helper
export async function getAuthPayload(c: any): Promise<any | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.split(' ')[1];
    return await verifyToken(token);
}
