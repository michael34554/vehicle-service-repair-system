import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type WorkshopRole = 'owner' | 'manager' | 'advisor' | 'technician';
export type CustomerRole = 'customer';
export type AnyRole = WorkshopRole | CustomerRole;
export type TokenType = 'access' | 'refresh';

export interface JwtClaims {
  sub: string;
  wid: string;
  role: AnyRole;
  sid: string;
  jti: string;
  type: TokenType;
  csrf: string;
  iat: number;
  exp: number;
  iss: 'nextgen';
  aud: 'nextgen-web';
}

export class JwtError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired'
  ) {
    super(message);
  }
}

const ISSUER = 'nextgen';
const AUDIENCE = 'nextgen-web';
const ROLE_VALUES: readonly AnyRole[] = ['owner', 'manager', 'advisor', 'technician', 'customer'];
const TOKEN_TYPES: readonly TokenType[] = ['access', 'refresh'];
const configuredSecret = process.env.NEXTGEN_JWT_SECRET;

if (!configuredSecret || Buffer.byteLength(configuredSecret, 'utf8') < 32) {
  throw new Error('NEXTGEN_JWT_SECRET must be configured with at least 32 bytes.');
}

const secret: string = configuredSecret;

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(input: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

export function createJti(): string {
  return randomUUID();
}

export function createCsrfToken(): string {
  return randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
}

export function signJwt(claims: JwtClaims): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const input = `${header}.${payload}`;
  return `${input}.${signature(input).toString('base64url')}`;
}

export function verifyJwt(token: string, expectedType: TokenType, nowSeconds = Math.floor(Date.now() / 1000)): JwtClaims {
  const segments = token.split('.');
  if (segments.length !== 3 || token.length > 8192) {
    throw new JwtError('Invalid token.', 'invalid');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new JwtError('Invalid token.', 'invalid');

    const expectedSignature = signature(`${encodedHeader}.${encodedPayload}`);
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw new JwtError('Invalid token.', 'invalid');
    }

    const value = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<JwtClaims>;
    if (
      typeof value.sub !== 'string' || value.sub.length === 0 ||
      typeof value.wid !== 'string' || value.wid.length === 0 ||
      typeof value.sid !== 'string' || value.sid.length === 0 ||
      typeof value.jti !== 'string' || value.jti.length === 0 ||
      typeof value.csrf !== 'string' || value.csrf.length < 32 ||
      typeof value.iat !== 'number' || !Number.isInteger(value.iat) ||
      typeof value.exp !== 'number' || !Number.isInteger(value.exp) ||
      value.exp <= value.iat ||
      value.iss !== ISSUER || value.aud !== AUDIENCE ||
      !ROLE_VALUES.includes(value.role as WorkshopRole) ||
      !TOKEN_TYPES.includes(value.type as TokenType) ||
      value.type !== expectedType
    ) {
      throw new JwtError('Invalid token.', 'invalid');
    }

    if (value.iat > nowSeconds + 60) throw new JwtError('Invalid token.', 'invalid');
    if (value.exp <= nowSeconds) throw new JwtError('Token expired.', 'expired');
    return value as JwtClaims;
  } catch (error) {
    if (error instanceof JwtError) throw error;
    throw new JwtError('Invalid token.', 'invalid');
  }
}

export function tokenLifetimeSeconds(type: TokenType): number {
  return type === 'access' ? 15 * 60 : 7 * 24 * 60 * 60;
}

export function createClaims(
  identity: Pick<JwtClaims, 'sub' | 'wid' | 'role' | 'sid' | 'csrf'>,
  type: TokenType,
  expiresAtSeconds?: number
): JwtClaims {
  const iat = Math.floor(Date.now() / 1000);
  return {
    ...identity,
    jti: createJti(),
    type,
    iat,
    exp: Math.min(iat + tokenLifetimeSeconds(type), expiresAtSeconds ?? Number.MAX_SAFE_INTEGER),
    iss: ISSUER,
    aud: AUDIENCE,
  };
}

export function isCustomerRole(value: unknown): value is CustomerRole {
  return value === 'customer';
}

export function isAnyRole(value: unknown): value is AnyRole {
  return ROLE_VALUES.includes(value as AnyRole);
}
