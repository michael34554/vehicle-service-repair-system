import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db, initializeDatabase } from './db';
import { registerMechanicRoutes } from './mechanics';
import { describeAsset, registerSmartWorkshopCatalogueRoutes } from './smartWorkshopCatalogue';
import { seedSmartWorkshopCatalogue } from './smartWorkshopSeed';
import {
  COMPONENT_KEYS,
  INSPECTION_CONDITIONS,
  SMART_WORKSHOP_CONFIG,
  componentForFault,
  deriveComponentStatuses,
  isComponentKey,
  type SmartWorkshopInspection,
  type SmartWorkshopPrediction,
} from '../shared/smartWorkshop';
import { resolveCatalogueModel } from '../shared/vehicleCatalogue';
import {
  createClaims,
  createCsrfToken,
  createJti,
  JwtClaims,
  JwtError,
  signJwt,
  tokenLifetimeSeconds,
  TokenType,
  verifyJwt,
  WorkshopRole,
  isCustomerRole,
} from './jwt';
import { isStaffRole } from '../shared/permissions';
import { customerNotificationTemplate, REPAIR_TRACKING_STAGES, repairStageIndex, repairStageLabel } from '../shared/customerPortal';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const ACCESS_COOKIE = 'nextgen_access';
const REFRESH_COOKIE = 'nextgen_refresh';
const CSRF_COOKIE = 'nextgen_csrf';
const LEGACY_SESSION_COOKIE = 'pitlane_session';
const ABSOLUTE_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
// For customer accounts
const CUSTOMER_ACCESS_COOKIE = 'nextgen_customer_access';
const CUSTOMER_REFRESH_COOKIE = 'nextgen_customer_refresh';
// Utility: set customer auth cookies
function setCustomerAuthCookies(response: Response, accessToken: string, refreshToken: string, csrfToken: string): void {
  setCookie(response, CUSTOMER_ACCESS_COOKIE, accessToken, tokenLifetimeSeconds('access'), '/api/customer', true);
  setCookie(response, CUSTOMER_REFRESH_COOKIE, refreshToken, tokenLifetimeSeconds('refresh'), '/api/customer/auth', true);
  setCookie(response, CSRF_COOKIE, csrfToken, tokenLifetimeSeconds('refresh'), '/', false);
}

function clearCustomerAuthCookies(response: Response): void {
  setCookie(response, CUSTOMER_ACCESS_COOKIE, '', 0, '/api/customer', true);
  setCookie(response, CUSTOMER_REFRESH_COOKIE, '', 0, '/api/customer/auth', true);
}

// Second precision keeps newly issued JWT `iat` values aligned with revocation timestamps.
function sessionClockNow(): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

interface CustomerTokenAccount {
  id: string;
  customer_id: string;
  workshop_id: string;
}

async function issueCustomerTokenPair(
  sessionId: string,
  account: CustomerTokenAccount,
  csrf: string,
  absoluteExpiresAtSeconds: number
): Promise<{ accessToken: string; refreshToken: string; accessJti: string; refreshJti: string }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date(nowSeconds * 1000).toISOString();
  const identity = {
    sub: account.customer_id,
    wid: account.workshop_id,
    role: 'customer' as const,
    sid: sessionId,
    csrf,
  };
  const accessJti = createJti();
  const refreshJti = createJti();
  const accessClaims = createClaims(identity, 'access', absoluteExpiresAtSeconds, accessJti);
  const refreshClaims = createClaims(identity, 'refresh', absoluteExpiresAtSeconds, refreshJti);
  await db.transaction(async () => {
    await db.execute(`
      INSERT INTO customer_jwt_tokens (jti, session_id, token_type, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, accessJti, sessionId, 'access', new Date(accessClaims.exp * 1000).toISOString(), now);
    await db.execute(`
      INSERT INTO customer_jwt_tokens (jti, session_id, token_type, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, refreshJti, sessionId, 'refresh', new Date(refreshClaims.exp * 1000).toISOString(), now);
    await db.execute('UPDATE customer_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL', now, sessionId);
  });
  return {
    accessToken: signJwt(accessClaims),
    refreshToken: signJwt(refreshClaims),
    accessJti,
    refreshJti,
  };
}

async function createCustomerSession(account: CustomerTokenAccount, csrf: string): Promise<{ accessToken: string; refreshToken: string }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const now = new Date(nowSeconds * 1000).toISOString();
  const sessionId = randomUUID();
  const expiresAt = new Date((nowSeconds + tokenLifetimeSeconds('refresh')) * 1000).toISOString();
  const absoluteExpiresAt = new Date((nowSeconds + ABSOLUTE_SESSION_DURATION_SECONDS) * 1000).toISOString();
  await db.execute(`
    INSERT INTO customer_sessions (
      id, customer_account_id, customer_id, workshop_id,
      created_at, expires_at, absolute_expires_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, sessionId, account.id, account.customer_id, account.workshop_id, now, expiresAt, absoluteExpiresAt, now);
  return await issueCustomerTokenPair(sessionId, account, csrf, Math.floor(new Date(absoluteExpiresAt).getTime() / 1000));
}

async function revokeCustomerSession(sessionId: string, at = sessionClockNow()): Promise<void> {
  await db.transaction(async () => {
    await db.execute('UPDATE customer_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', at, sessionId);
    await db.execute('UPDATE customer_jwt_tokens SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL', at, sessionId);
  });
}

async function revokeCustomerToken(jti: string, replacementJti: string | null, at = sessionClockNow()): Promise<void> {
  await db.execute(`
    UPDATE customer_jwt_tokens
    SET revoked_at = ?, replaced_by_jti = ?
    WHERE jti = ? AND revoked_at IS NULL
  `, at, replacementJti, jti);
}

// Customer session validation middleware
async function validateCustomerAuth(request: express.Request, response: Response): Promise<boolean> {
  const token = readCookie(request, CUSTOMER_ACCESS_COOKIE);
  if (!token) {
    response.status(401).json({ error: 'authentication_required' });
    return false;
  }
  let claims: JwtClaims;
  try {
    claims = verifyJwt(token, 'access');
  } catch (error) {
    response.status(401).json({ error: error instanceof JwtError && error.code === 'expired' ? 'access_token_expired' : 'authentication_required' });
    return false;
  }

  // Explicitly bind the CSRF claim to the cookie on every customer request.
  const csrfCookie = readCookie(request, CSRF_COOKIE);
  if (!csrfCookie || !constantTimeMatch(csrfCookie, claims.csrf)) {
    response.status(401).json({ error: 'csrf_validation_failed' });
    return false;
  }

  const auth = await db.first(`
    SELECT ca.id AS account_id, ca.customer_id, ca.workshop_id, ca.email,
           c.display_name, cs.id AS session_id, cs.absolute_expires_at, ca.updated_at
    FROM customer_jwt_tokens tok
    JOIN customer_sessions cs ON cs.id = tok.session_id AND cs.revoked_at IS NULL
    JOIN customer_accounts ca ON ca.id = cs.customer_account_id
    JOIN customers c ON c.id = ca.customer_id AND c.workshop_id = ca.workshop_id
    WHERE tok.jti = ? AND tok.token_type = 'access' AND tok.revoked_at IS NULL
      AND cs.id = ? AND ca.workshop_id = ? AND ca.customer_id = ?
  `, claims.jti, claims.sid, claims.wid, claims.sub) as {
    account_id: string;
    customer_id: string;
    workshop_id: string;
    email: string;
    display_name: string;
    session_id: string;
    absolute_expires_at: string;
    updated_at: string;
  } | undefined;
  if (!auth) {
    response.status(401).json({ error: 'authentication_required' });
    return false;
  }
  if (!isCustomerRole(claims.role)) {
    response.status(403).json({ error: 'account_role_not_supported' });
    return false;
  }

  const absoluteExpiry = new Date(auth.absolute_expires_at).getTime();
  const accountUpdated = new Date(auth.updated_at).getTime();
  if (Number.isFinite(absoluteExpiry) && absoluteExpiry <= Date.now()) {
    response.status(401).json({ error: 'session_expired' });
    return false;
  }
  if (Number.isFinite(accountUpdated) && claims.iat * 1000 < accountUpdated) {
    response.status(401).json({ error: 'session_revoked' });
    return false;
  }
  await db.execute('UPDATE customer_sessions SET last_used_at = ? WHERE id = ?', sessionClockNow(), auth.session_id);

  response.locals.customer = { ...auth, csrf: claims.csrf };
  return true;
}

function requireCustomerAuth(request: express.Request, response: Response, next: NextFunction): void {
  void validateCustomerAuth(request, response).then((authenticated) => {
    if (authenticated) next();
  }).catch(next);
}
const DUMMY_SALT = Buffer.alloc(16, 23);
const DUMMY_HASH = scryptSync('nextgen-invalid-login-dummy', DUMMY_SALT, 64, SCRYPT_OPTIONS);
await initializeDatabase();
// Versioned migration 005 creates the catalogue tables; the seed is idempotent.
await seedSmartWorkshopCatalogue(db);

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

interface AuthContext {
  id: string;
  name: string;
  email: string;
  role: WorkshopRole;
  workshop_id: string;
  workshop_name: string;
  session_id: string;
  jti: string;
  csrf: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type AsyncHandler = (request: express.Request, response: Response, next: NextFunction) => Promise<void>;

const app = express();
app.disable('x-powered-by');
app.use((_, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/api', csrfProtection);

function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, minLength: number, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} is required.`);
  }
  const result = value.trim();
  if (result.length < minLength || result.length > maxLength) {
    throw new HttpError(400, `${label} must be between ${minLength} and ${maxLength} characters.`);
  }
  return result;
}

function normalizedEmail(value: unknown): string {
  const email = requiredText(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function readCookie(request: express.Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const item = cookieHeader.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  if (!item) return undefined;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

function constantTimeMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function setCookie(response: Response, name: string, value: string, maxAge: number, path: string, httpOnly: boolean): void {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  const httpOnlyFlag = httpOnly ? '; HttpOnly' : '';
  response.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${httpOnlyFlag}${secure}`
  );
}

function setAuthCookies(response: Response, accessToken: string, refreshToken: string, csrfToken: string): void {
  setCookie(response, ACCESS_COOKIE, accessToken, tokenLifetimeSeconds('access'), '/', true);
  setCookie(response, REFRESH_COOKIE, refreshToken, tokenLifetimeSeconds('refresh'), '/api/auth', true);
  setCookie(response, CSRF_COOKIE, csrfToken, tokenLifetimeSeconds('refresh'), '/', false);
}

function clearAuthCookies(response: Response): void {
  setCookie(response, ACCESS_COOKIE, '', 0, '/', true);
  setCookie(response, REFRESH_COOKIE, '', 0, '/api/auth', true);
  setCookie(response, CSRF_COOKIE, '', 0, '/', false);
  setCookie(response, LEGACY_SESSION_COOKIE, '', 0, '/', true);
}

function authRateLimit(maxRequests: number, windowMs: number): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  let requestsSinceCleanup = 0;
  return (request, response, next) => {
    const now = Date.now();
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 100) {
      for (const [ip, attempt] of attempts) {
        if (attempt.resetAt <= now) attempts.delete(ip);
      }
      requestsSinceCleanup = 0;
    }
    const key = request.ip ?? 'unknown';
    const current = attempts.get(key);
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= maxRequests) {
      response.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
      return;
    }
    current.count += 1;
    next();
  };
}

const limitAuthAttempts = authRateLimit(10, 15 * 60 * 1000);
const limitLoginAttempts = authRateLimit(10, 15 * 60 * 1000);
const limitCustomerNameLogin = authRateLimit(5, 15 * 60 * 1000);

async function validateAuth(request: express.Request, response: Response): Promise<boolean> {
  const token = readCookie(request, ACCESS_COOKIE);
  if (!token) {
    response.status(401).json({ error: 'authentication_required' });
    return false;
  }

  let claims: JwtClaims;
  try {
    claims = verifyJwt(token, 'access');
  } catch (error) {
    response.status(401).json({ error: error instanceof JwtError && error.code === 'expired' ? 'access_token_expired' : 'authentication_required' });
    return false;
  }

  const now = new Date().toISOString();
  const auth = await db.first(`
    SELECT users.id, users.name, users.email, users.role,
           users.workshop_id, workshop_settings.name AS workshop_name,
           jwt_sessions.id AS session_id, jwt_tokens.jti, ? AS csrf
    FROM jwt_tokens
    JOIN jwt_sessions ON jwt_sessions.id = jwt_tokens.session_id
    JOIN users ON users.id = jwt_sessions.user_id AND users.workshop_id = jwt_sessions.workshop_id
    JOIN workshop_settings ON workshop_settings.workshop_id = users.workshop_id
    WHERE jwt_tokens.jti = ? AND jwt_tokens.token_type = 'access'
      AND jwt_tokens.revoked_at IS NULL AND jwt_tokens.expires_at > ?
      AND jwt_sessions.id = ? AND jwt_sessions.revoked_at IS NULL AND jwt_sessions.expires_at > ?
      AND users.id = ? AND users.workshop_id = ?
  `, claims.csrf, claims.jti, now, claims.sid, now, claims.sub, claims.wid) as AuthContext | undefined;

  if (!auth) {
    response.status(401).json({ error: 'authentication_required' });
    return false;
  }

  if (!isWorkshopRole(auth.role)) {
    response.status(403).json({ error: 'account_role_not_supported' });
    return false;
  }

  response.locals.auth = auth;
  return true;
}

function requireAuth(request: express.Request, response: Response, next: NextFunction): void {
  void validateAuth(request, response).then((authenticated) => {
    if (authenticated) next();
  }).catch(next);
}

function isWorkshopRole(value: unknown): value is WorkshopRole {
  return value === 'owner' || value === 'manager' || value === 'advisor' || value === 'technician';
}

interface AccountIdentity {
  id: string;
  workshop_id: string;
  role: WorkshopRole;
}

async function insertToken(claims: JwtClaims, createdAt: string): Promise<string> {
  const token = signJwt(claims);
  await db.execute(`
    INSERT INTO jwt_tokens (jti, session_id, token_type, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, claims.jti, claims.sid, claims.type, new Date(claims.exp * 1000).toISOString(), createdAt);
  return token;
}

async function issueTokenPair(user: AccountIdentity, sessionId?: string, sessionExpiresAt?: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessJti: string;
  refreshJti: string;
  csrf: string;
  sessionId: string;
}> {
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const createdAt = now.toISOString();
  const absoluteExpirySeconds = sessionExpiresAt
    ? Math.floor(new Date(sessionExpiresAt).getTime() / 1000)
    : nowSeconds + ABSOLUTE_SESSION_DURATION_SECONDS;
  const id = sessionId ?? randomUUID();
  const csrf = createCsrfToken();
  const identity = { sub: user.id, wid: user.workshop_id, role: user.role, sid: id, csrf };
  const accessClaims = createClaims(identity, 'access', absoluteExpirySeconds);
  const refreshClaims = createClaims(identity, 'refresh', absoluteExpirySeconds);

  if (!sessionId) {
    await db.execute(`
      INSERT INTO jwt_sessions (id, user_id, workshop_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `, id, user.id, user.workshop_id, createdAt, new Date(absoluteExpirySeconds * 1000).toISOString());
  }

  return {
    accessToken: await insertToken(accessClaims, createdAt),
    refreshToken: await insertToken(refreshClaims, createdAt),
    accessJti: accessClaims.jti,
    refreshJti: refreshClaims.jti,
    csrf,
    sessionId: id,
  };
}

async function revokeSession(sessionId: string, now: string): Promise<void> {
  await db.execute('UPDATE jwt_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', now, sessionId);
  await db.execute('UPDATE jwt_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE session_id = ?', now, sessionId);
}

function csrfProtection(request: express.Request, response: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next();
    return;
  }

  const isCustomerRequest = request.path.startsWith('/customer/');
  const cookieToken = readCookie(request, CSRF_COOKIE);
  const headerToken = request.get('X-CSRF-TOKEN');
  if (!cookieToken || !headerToken || !constantTimeMatch(cookieToken, headerToken)) {
    response.status(403).json({ error: 'csrf_validation_failed' });
    return;
  }

  const isRefreshRequest = request.path === '/auth/refresh' || request.path === '/customer/auth/refresh';
  const accessToken = readCookie(request, isCustomerRequest ? CUSTOMER_ACCESS_COOKIE : ACCESS_COOKIE);
  const refreshToken = readCookie(request, isCustomerRequest ? CUSTOMER_REFRESH_COOKIE : REFRESH_COOKIE);
  const jwt = isRefreshRequest ? refreshToken : accessToken;
  const jwtType: TokenType = isRefreshRequest ? 'refresh' : 'access';
  if (jwt) {
    try {
      const claims = verifyJwt(jwt, jwtType);
      if (!constantTimeMatch(cookieToken, claims.csrf)) {
        response.status(403).json({ error: 'csrf_validation_failed' });
        return;
      }
    } catch (error) {
      const isLoginOrRegistration = request.path === '/auth/login' || request.path === '/auth/register' ||
        request.path === '/customer/auth/name';
      if (!(error instanceof JwtError && error.code === 'expired') && !isLoginOrRegistration && request.path !== '/auth/logout' && request.path !== '/customer/auth/logout') {
        response.status(403).json({ error: 'csrf_validation_failed' });
        return;
      }
    }
  }
  next();
}

const accountQuery = `
  SELECT users.id, users.name, users.email, users.role,
         workshop_settings.name AS workshop_name
  FROM users
  JOIN workshop_settings ON workshop_settings.workshop_id = users.workshop_id
  WHERE users.id = ?
`;

app.post('/api/auth/register', limitAuthAttempts, asyncRoute(async (request, response) => {
  const body = requireObject(request.body);
  const name = requiredText(body.name, 'Name', 2, 100);
  const email = normalizedEmail(body.email);
  const password = requiredText(body.password, 'Password', 8, 128);
  const workshopName = requiredText(body.workshopName, 'Workshop name', 2, 120);
  const salt = randomBytes(16);
  const passwordHash = await derivePassword(password, salt);
  const userId = randomUUID();
  const workshopId = randomUUID();
  const now = new Date().toISOString();
  const identity: AccountIdentity = { id: userId, workshop_id: workshopId, role: 'owner' };
  const tokens = await db.transaction(async () => {
    await db.execute('INSERT INTO workshops (id, created_at) VALUES (?, ?)', workshopId, now);
    await db.execute(`
      INSERT INTO workshop_settings (workshop_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `, workshopId, workshopName, now, now);
    await db.execute(`
      INSERT INTO users (id, workshop_id, name, email, password_hash, password_salt, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'owner', ?)
    `, userId, workshopId, name, email, passwordHash.toString('hex'), salt.toString('hex'), now);
    return await issueTokenPair(identity);
  });

  setAuthCookies(response, tokens.accessToken, tokens.refreshToken, tokens.csrf);
  response.status(201).json({ user: await db.first(accountQuery, userId) });
}));

app.post('/api/auth/login', limitLoginAttempts, asyncRoute(async (request, response) => {
  const body = requireObject(request.body);
  const email = normalizedEmail(body.email);
  const password = requiredText(body.password, 'Password', 1, 128);
  const user = await db.first(`
    SELECT id, workshop_id, role, password_hash, password_salt
    FROM users WHERE email = ?
  `, email) as {
    id: string;
    workshop_id: string;
    role: string;
    password_hash: string;
    password_salt: string;
  } | undefined;

  const salt = user ? Buffer.from(user.password_salt, 'hex') : DUMMY_SALT;
  const derivedHash = await derivePassword(password, salt);
  const expectedHash = user ? Buffer.from(user.password_hash, 'hex') : DUMMY_HASH;
  if (!user || !timingSafeEqual(derivedHash, expectedHash)) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  if (!isWorkshopRole(user.role)) throw new HttpError(403, 'This account has an unsupported role.');
  const mechanicProfile = await db.first(`
    SELECT employment_status FROM mechanics WHERE user_id = ? AND workshop_id = ?
  `, user.id, user.workshop_id) as { employment_status: string } | undefined;
  if (mechanicProfile && mechanicProfile.employment_status !== 'Active') {
    throw new HttpError(403, 'This mechanic account is inactive. Contact an administrator.');
  }

  const tokens = await db.transaction(() =>
    issueTokenPair({ id: user.id, workshop_id: user.workshop_id, role: user.role as WorkshopRole })
  );
  setAuthCookies(response, tokens.accessToken, tokens.refreshToken, tokens.csrf);
  response.json({ user: await db.first(accountQuery, user.id) });
}));

app.get('/api/auth/csrf', asyncRoute(async (request, response) => {
  const csrf = readCookie(request, CSRF_COOKIE);
  const token = csrf && /^[a-f0-9]{64}$/.test(csrf) ? csrf : createCsrfToken();
  if (token !== csrf) setCookie(response, CSRF_COOKIE, token, tokenLifetimeSeconds('refresh'), '/', false);
  response.json({ csrfToken: token });
}));

app.get('/api/auth/me', asyncRoute(async (request, response) => {
  if (!readCookie(request, ACCESS_COOKIE)) {
    if (readCookie(request, REFRESH_COOKIE)) {
      response.status(401).json({ error: 'authentication_required' });
      return;
    }
    response.json({ user: null });
    return;
  }

  requireAuth(request, response, () => {
    const auth = response.locals.auth as AuthContext;
    response.json({
      user: { id: auth.id, name: auth.name, email: auth.email, role: auth.role },
      workshop: { id: auth.workshop_id, name: auth.workshop_name },
    });
  });
}));

app.post('/api/auth/refresh', limitAuthAttempts, asyncRoute(async (request, response) => {
  const token = readCookie(request, REFRESH_COOKIE);
  if (!token) {
    clearAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_required' });
    return;
  }

  let claims: JwtClaims;
  try {
    claims = verifyJwt(token, 'refresh');
  } catch (error) {
    clearAuthCookies(response);
    response.status(401).json({ error: error instanceof JwtError && error.code === 'expired' ? 'refresh_token_expired' : 'refresh_token_invalid' });
    return;
  }

  const now = new Date().toISOString();
  const session = await db.first(`
    SELECT jwt_tokens.revoked_at AS token_revoked_at, jwt_tokens.expires_at AS token_expires_at,
           jwt_sessions.revoked_at AS session_revoked_at, jwt_sessions.expires_at AS session_expires_at,
           users.id, users.workshop_id, users.role
    FROM jwt_tokens
    JOIN jwt_sessions ON jwt_sessions.id = jwt_tokens.session_id
    JOIN users ON users.id = jwt_sessions.user_id AND users.workshop_id = jwt_sessions.workshop_id
    WHERE jwt_tokens.jti = ? AND jwt_tokens.session_id = ? AND jwt_tokens.token_type = 'refresh'
      AND users.id = ? AND users.workshop_id = ?
  `, claims.jti, claims.sid, claims.sub, claims.wid) as {
    token_revoked_at: string | null;
    token_expires_at: string;
    session_revoked_at: string | null;
    session_expires_at: string;
    id: string;
    workshop_id: string;
    role: string;
  } | undefined;

  if (!session) {
    clearAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_invalid' });
    return;
  }
  if (session.token_revoked_at || session.session_revoked_at) {
    await revokeSession(claims.sid, now);
    clearAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_revoked' });
    return;
  }
  if (new Date(session.token_expires_at).getTime() <= Date.now() ||
      new Date(session.session_expires_at).getTime() <= Date.now()) {
    await revokeSession(claims.sid, now);
    clearAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_expired' });
    return;
  }
  if (!isWorkshopRole(session.role)) {
    await revokeSession(claims.sid, now);
    clearAuthCookies(response);
    response.status(403).json({ error: 'account_role_not_supported' });
    return;
  }

  let tokens: Awaited<ReturnType<typeof issueTokenPair>> | undefined;
  let rotated = false;
  await db.transaction(async () => {
    const updated = await db.execute(`
      UPDATE jwt_tokens SET revoked_at = ?
      WHERE jti = ? AND token_type = 'refresh' AND revoked_at IS NULL AND expires_at > ?
    `, now, claims.jti, now);
    if (updated.affectedRows === 1) {
      tokens = await issueTokenPair(
        { id: session.id, workshop_id: session.workshop_id, role: session.role as WorkshopRole },
        claims.sid,
        session.session_expires_at
      );
      await db.execute('UPDATE jwt_tokens SET replaced_by_jti = ? WHERE jti = ?', tokens.refreshJti, claims.jti);
      rotated = true;
    }
  });

  if (!rotated || !tokens) {
    await revokeSession(claims.sid, now);
    clearAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_reused' });
    return;
  }

  setAuthCookies(response, tokens.accessToken, tokens.refreshToken, tokens.csrf);
  response.json({ refreshed: true });
}));

app.post('/api/auth/logout', asyncRoute(async (request, response) => {
  const accessToken = readCookie(request, ACCESS_COOKIE);
  const refreshToken = readCookie(request, REFRESH_COOKIE);
  for (const [token, type] of [[accessToken, 'access'], [refreshToken, 'refresh']] as const) {
    if (!token) continue;
    try {
      const claims = verifyJwt(token, type);
      await revokeSession(claims.sid, new Date().toISOString());
      break;
    } catch (error) {
      if (!(error instanceof JwtError)) throw error;
    }
  }
  clearAuthCookies(response);
  response.status(204).end();
}));

app.get('/api/users', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  if (auth.role !== 'owner' && auth.role !== 'manager') throw new HttpError(403, 'role_forbidden');
  const users = await db.query(`
    SELECT id, name, email, role, created_at
    FROM users WHERE workshop_id = ?
    ORDER BY created_at ASC
  `, auth.workshop_id);
  response.json({ records: users });
}));

app.post('/api/users', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  if (auth.role !== 'owner' && auth.role !== 'manager') throw new HttpError(403, 'role_forbidden');
  const body = requireObject(request.body);
  const name = requiredText(body.name, 'Name', 2, 100);
  const email = normalizedEmail(body.email);
  const password = requiredText(body.password, 'Password', 8, 128);
  const role = body.role;
  const allowedRoles: readonly WorkshopRole[] = auth.role === 'owner'
    ? ['manager', 'advisor', 'technician']
    : ['advisor', 'technician'];
  if (typeof role !== 'string' || !allowedRoles.includes(role as WorkshopRole)) {
    throw new HttpError(403, 'role_assignment_forbidden');
  }

  const salt = randomBytes(16);
  const passwordHash = await derivePassword(password, salt);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute(`
    INSERT INTO users (id, workshop_id, name, email, password_hash, password_salt, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, id, auth.workshop_id, name, email, passwordHash.toString('hex'), salt.toString('hex'), role, createdAt);
  const user = await db.first(`
    SELECT id, name, email, role, created_at
    FROM users WHERE id = ? AND workshop_id = ?
  `, id, auth.workshop_id);
  response.status(201).json({ user });
}));

app.patch('/api/users/:id', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  if (auth.role !== 'owner') throw new HttpError(403, 'role_forbidden');
  if (request.params.id === auth.id) throw new HttpError(400, 'You cannot change your own account role.');
  const body = requireObject(request.body);
  const allowedFields = ['role', 'name'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new HttpError(400, 'Only name and role can be changed here.');
  }

  const assignments: string[] = [];
  const values: string[] = [];
  if (body.name !== undefined) {
    assignments.push('name = ?');
    values.push(requiredText(body.name, 'Name', 2, 100));
  }
  if (body.role !== undefined) {
    if (body.role !== 'manager' && body.role !== 'advisor' && body.role !== 'technician') {
      throw new HttpError(400, 'Unsupported account role.');
    }
    assignments.push('role = ?');
    values.push(body.role);
  }
  if (assignments.length === 0) throw new HttpError(400, 'Provide a name or role to update.');
  const result = await db.execute(`
    UPDATE users SET ${assignments.join(', ')}
    WHERE id = ? AND workshop_id = ? AND role != 'owner'
  `, ...values, request.params.id, auth.workshop_id);
  if (result.affectedRows === 0) throw new HttpError(404, 'That staff account was not found.');
  const user = await db.first(`
    SELECT id, name, email, role, created_at
    FROM users WHERE id = ? AND workshop_id = ?
  `, request.params.id, auth.workshop_id);
  response.json({ user });
}));

app.delete('/api/users/:id', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  if (auth.role !== 'owner') throw new HttpError(403, 'role_forbidden');
  if (request.params.id === auth.id) throw new HttpError(400, 'You cannot delete your own account.');
  await db.transaction(async () => {
    const result = await db.execute(`
      DELETE FROM users
      WHERE id = ? AND workshop_id = ? AND role != 'owner'
    `, request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'That staff account was not found.');

  });

  response.status(204).end();
}));

type FieldRule =
  | { type: 'text'; maxLength: number; nullable?: boolean }
  | { type: 'email'; maxLength: number; nullable?: boolean }
  | { type: 'integer'; min: number; max?: number; nullable?: boolean }
  | { type: 'enum'; values: readonly string[]; nullable?: boolean };

type FieldMap = Record<string, FieldRule>;

interface ResourceDefinition {
  table: string;
  fields: FieldMap;
  required: readonly string[];
  references?: Record<string, string>;
}

const resources = {
  customers: {
    table: 'customers',
    required: ['display_name'],
    fields: {
      display_name: { type: 'text', maxLength: 120 },
      phone: { type: 'text', maxLength: 40, nullable: true },
      email: { type: 'email', maxLength: 254, nullable: true },
      notes: { type: 'text', maxLength: 2000, nullable: true },
    },
  },
  vehicles: {
    table: 'vehicles',
    required: ['plate', 'make', 'model', 'model_year'],
    fields: {
      customer_id: { type: 'text', maxLength: 36, nullable: true },
      plate: { type: 'text', maxLength: 24 },
      vin: { type: 'text', maxLength: 32, nullable: true },
      make: { type: 'text', maxLength: 80 },
      model: { type: 'text', maxLength: 100 },
      model_year: { type: 'integer', min: 1886, max: 2200 },
      color: { type: 'text', maxLength: 50, nullable: true },
      mileage: { type: 'integer', min: 0 },
    },
    references: { customer_id: 'customers' },
  },
  jobs: {
    table: 'jobs',
    required: ['vehicle_id', 'job_no', 'service_type'],
    fields: {
      vehicle_id: { type: 'text', maxLength: 36 },
      job_no: { type: 'text', maxLength: 40 },
      service_type: { type: 'text', maxLength: 160 },
      issue_description: { type: 'text', maxLength: 2000, nullable: true },
      status: { type: 'enum', values: ['Pending', 'In Progress', 'Awaiting Parts', 'Quality Check', 'Completed'] },
      priority: { type: 'enum', values: ['urgent', 'high', 'standard'] },
      bay: { type: 'text', maxLength: 80, nullable: true },
      assigned_technician: { type: 'text', maxLength: 120, nullable: true },
      estimated_amount_cents: { type: 'integer', min: 0 },
      final_amount_cents: { type: 'integer', min: 0, nullable: true },
      promised_at: { type: 'text', maxLength: 50, nullable: true },
      notes: { type: 'text', maxLength: 2000, nullable: true },
    },
    references: { vehicle_id: 'vehicles' },
  },
} satisfies Record<string, ResourceDefinition>;

type ResourceName = keyof typeof resources;

function validateFields(
  rules: FieldMap,
  body: Record<string, unknown>,
  required: readonly string[]
): Record<string, string | number | null> {
  for (const key of Object.keys(body)) {
    if (!(key in rules)) throw new HttpError(400, `The "${key}" field cannot be changed here.`);
  }

  const result: Record<string, string | number | null> = {};
  for (const [field, rule] of Object.entries(rules)) {
    if (!(field in body)) {
      if (required.includes(field)) throw new HttpError(400, `${field.replaceAll('_', ' ')} is required.`);
      continue;
    }
    const value = body[field];
    if ((value === null || value === '') && rule.nullable) {
      result[field] = null;
    } else if (rule.type === 'text') {
      result[field] = requiredText(value, field.replaceAll('_', ' '), 1, rule.maxLength);
    } else if (rule.type === 'email') {
      result[field] = value === null || value === ''
        ? null
        : normalizedEmail(value);
      if (typeof result[field] === 'string' && result[field].length > rule.maxLength) {
        throw new HttpError(400, 'Email is too long.');
      }
    } else if (rule.type === 'integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < rule.min || (rule.max !== undefined && value > rule.max)) {
        throw new HttpError(400, `${field.replaceAll('_', ' ')} must be a valid whole number.`);
      }
      result[field] = value;
    } else {
      if (typeof value !== 'string' || !rule.values.includes(value)) {
        throw new HttpError(400, `${field.replaceAll('_', ' ')} has an unsupported value.`);
      }
      result[field] = value;
    }
  }
  return result;
}

function getResource(name: string): ResourceDefinition {
  if (!Object.hasOwn(resources, name)) throw new HttpError(404, 'That record type was not found.');
  return resources[name as ResourceName];
}

function authorizeResource(method: 'read' | 'create' | 'update' | 'delete'): RequestHandler {
  return (request, response, next) => {
    try {
      const auth = response.locals.auth as AuthContext;
      const resource = request.params.resource;
      const isManagementRole = auth.role === 'owner' || auth.role === 'manager';
      const isStaffRole = isManagementRole || auth.role === 'advisor';
      const technicianRead = auth.role === 'technician' &&
        method === 'read' &&
        ['jobs', 'vehicles'].includes(resource);
      const allowed = method === 'read'
        ? isStaffRole || technicianRead
        : method === 'create'
          ? isStaffRole
          : method === 'update'
            ? isStaffRole || (auth.role === 'technician' && resource === 'jobs')
            : isManagementRole;

      if (!allowed) {
        response.status(403).json({ error: 'role_forbidden' });
        return;
      }

      if (auth.role === 'technician' && method === 'update') {
        const body = requireObject(request.body);
        const fields = Object.keys(body);
        if (fields.length === 0 || fields.some((field) => !['status', 'notes'].includes(field))) {
          response.status(403).json({ error: 'technicians_may_only_update_job_status_and_notes' });
          return;
        }
        if (body.status !== undefined && !['In Progress', 'Awaiting Parts', 'Quality Check', 'Completed'].includes(String(body.status))) {
          response.status(403).json({ error: 'technician_job_status_transition_forbidden' });
          return;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

async function checkReferences(
  definition: ResourceDefinition,
  values: Record<string, string | number | null>,
  workshopId: string
): Promise<void> {
  for (const [field, table] of Object.entries(definition.references ?? {})) {
    const value = values[field];
    if (value === undefined || value === null) continue;
    const found = await db.first(`SELECT 1 FROM ${table} WHERE id = ? AND workshop_id = ?`, value, workshopId);
    if (!found) throw new HttpError(400, `${field.replaceAll('_', ' ')} does not belong to this workshop.`);
  }
}

function requireCustomerStaff(auth: AuthContext): void {
  if (!isStaffRole(auth.role)) throw new HttpError(403, 'role_forbidden');
}

function normalizedPhone(value: unknown): { phone: string; normalized: string } {
  const phone = requiredText(value, 'Phone number', 1, 40);
  if (!/^\+?[\d\s().-]+$/.test(phone)) {
    throw new HttpError(400, 'Enter a valid phone number.');
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, 'Phone number must contain between 7 and 15 digits.');
  }
  return { phone, normalized: digits };
}

function optionalCustomerEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return normalizedEmail(value);
}

function optionalCustomerText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, label, 1, maxLength);
}

function customerFields(body: Record<string, unknown>) {
  const allowed = ['full_name', 'phone_number', 'email', 'address', 'gender'];
  if (Object.keys(body).some((field) => !allowed.includes(field))) {
    throw new HttpError(400, 'Only customer contact and profile fields can be changed.');
  }
  const phone = normalizedPhone(body.phone_number);
  const gender = body.gender === undefined || body.gender === null || body.gender === ''
    ? null
    : body.gender;
  if (gender !== null && !['female', 'male', 'non_binary', 'prefer_not_to_say'].includes(String(gender))) {
    throw new HttpError(400, 'Select a supported gender option.');
  }
  return {
    fullName: requiredText(body.full_name, 'Full name', 2, 120),
    phone: phone.phone,
    normalizedPhone: phone.normalized,
    email: optionalCustomerEmail(body.email),
    address: optionalCustomerText(body.address, 'Address', 500),
    gender: gender as string | null,
  };
}

const customerSelect = `
  SELECT id, customer_code, display_name AS full_name, phone AS phone_number,
    email, address, gender, created_at, updated_at
  FROM customers
`;

async function findCustomerDuplicates(
  workshopId: string,
  phone: string,
  email: string | null,
  excludeId?: string
) {
  const duplicateConditions = ['phone_normalized = ?'];
  const bindings: (string | null)[] = [workshopId, phone];
  if (email) {
    duplicateConditions.push('lower(email) = ?');
    bindings.push(email);
  }
  let excludeClause = '';
  if (excludeId) {
    excludeClause = ' AND id != ?';
    bindings.push(excludeId);
  }
  return await db.query(`
    ${customerSelect}
    WHERE workshop_id = ? AND (${duplicateConditions.join(' OR ')})${excludeClause}
    ORDER BY created_at DESC
    LIMIT 10
  `, ...bindings);
}

function isCustomerUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

async function customerRecordExists(id: string, workshopId: string): Promise<boolean> {
  return Boolean(await db.first('SELECT 1 FROM customers WHERE id = ? AND workshop_id = ?', id, workshopId));
}

app.get('/api/customers/search', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireCustomerStaff(auth);
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (!query || query.length > 200) throw new HttpError(400, 'Enter a search term of 1 to 200 characters.');
    const like = `%${query}%`;
    const phoneDigits = query.replace(/\D/g, '');
    const records = await db.query(`
      ${customerSelect}
      WHERE workshop_id = ?
        AND (
          id LIKE ? OR customer_code LIKE ? OR display_name LIKE ?
          OR phone LIKE ? OR email LIKE ?
          OR (? != '' AND phone_normalized LIKE ?)
        )
      ORDER BY display_name ASC, created_at DESC
      LIMIT 50
    `, auth.workshop_id, like, like, like, like, like, phoneDigits, `%${phoneDigits}%`);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customers/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireCustomerStaff(auth);
    const record = await db.first(`
      ${customerSelect}
      WHERE id = ? AND workshop_id = ?
    `, request.params.id, auth.workshop_id);
    if (!record) throw new HttpError(404, 'Customer not found.');
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customers', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireCustomerStaff(auth);
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 100 and a non-negative offset.');
    }

    const sortFields: Record<string, string> = {
      customer_code: 'customer_code',
      full_name: 'display_name',
      phone_number: 'phone',
      email: 'email',
      created_at: 'created_at',
    };
    const sort = typeof request.query.sort === 'string' ? request.query.sort : 'created_at';
    const order = typeof request.query.order === 'string' ? request.query.order.toLowerCase() : 'desc';
    if (!Object.hasOwn(sortFields, sort) || !['asc', 'desc'].includes(order)) {
      throw new HttpError(400, 'Customer sorting options are invalid.');
    }

    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length > 200) throw new HttpError(400, 'Search terms cannot exceed 200 characters.');
    const conditions = ['workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (query) {
      const like = `%${query}%`;
      const phoneDigits = query.replace(/\D/g, '');
      conditions.push(`(
        id LIKE ? OR customer_code LIKE ? OR display_name LIKE ?
        OR phone LIKE ? OR email LIKE ?
        OR (? != '' AND phone_normalized LIKE ?)
      )`);
      bindings.push(like, like, like, like, like, phoneDigits, `%${phoneDigits}%`);
    }
    const where = conditions.join(' AND ');
    const total = (await db.first(`SELECT COUNT(*) AS total FROM customers WHERE ${where}`, ...bindings) as { total: number }).total;
    const registeredTotal = (await db.first('SELECT COUNT(*) AS total FROM customers WHERE workshop_id = ?', auth.workshop_id) as { total: number }).total;
    const records = await db.query(`
      ${customerSelect}
      WHERE ${where}
      ORDER BY ${sortFields[sort]} ${order.toUpperCase()}, created_at DESC
      LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({ records, total, registeredTotal, limit, offset });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/customers', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireCustomerStaff(auth);
    const values = customerFields(requireObject(request.body));
    const matches = await findCustomerDuplicates(
      auth.workshop_id,
      values.normalizedPhone,
      values.email
    );
    if (matches.length > 0) {
      response.status(409).json({
        error: 'duplicate_customer',
        message: 'A customer with this phone number or email address already exists.',
        matches,
      });
      return;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await db.execute(`
        INSERT INTO customers (
          id, workshop_id, customer_code, display_name, phone, phone_normalized,
          email, address, gender, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, auth.workshop_id, `CUST-${id.toUpperCase()}`, values.fullName, values.phone,
        values.normalizedPhone, values.email, values.address, values.gender, now, now);
    } catch (error) {
      if (!isCustomerUniqueConflict(error)) throw error;
      const duplicateMatches = await findCustomerDuplicates(
        auth.workshop_id,
        values.normalizedPhone,
        values.email
      );
      response.status(409).json({
        error: 'duplicate_customer',
        message: 'A customer with this phone number or email address already exists.',
        matches: duplicateMatches,
      });
      return;
    }
    const record = await db.first(`${customerSelect} WHERE id = ? AND workshop_id = ?`, id, auth.workshop_id);
    response.status(201).json({ record });
  } catch (error) {
    next(error);
  }
}));

app.put('/api/customers/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireCustomerStaff(auth);
    const id = request.params.id;
    if (!await customerRecordExists(id, auth.workshop_id)) throw new HttpError(404, 'Customer not found.');
    const values = customerFields(requireObject(request.body));
    const matches = await findCustomerDuplicates(
      auth.workshop_id,
      values.normalizedPhone,
      values.email,
      id
    );
    if (matches.length > 0) {
      response.status(409).json({
        error: 'duplicate_customer',
        message: 'Another customer already uses this phone number or email address.',
        matches,
      });
      return;
    }

    try {
      await db.execute(`
        UPDATE customers
        SET display_name = ?, phone = ?, phone_normalized = ?, email = ?,
          address = ?, gender = ?, updated_at = ?
        WHERE id = ? AND workshop_id = ?
      `, values.fullName, values.phone, values.normalizedPhone, values.email,
        values.address, values.gender, new Date().toISOString(), id, auth.workshop_id);
    } catch (error) {
      if (!isCustomerUniqueConflict(error)) throw error;
      const duplicateMatches = await findCustomerDuplicates(
        auth.workshop_id,
        values.normalizedPhone,
        values.email,
        id
      );
      response.status(409).json({
        error: 'duplicate_customer',
        message: 'Another customer already uses this phone number or email address.',
        matches: duplicateMatches,
      });
      return;
    }
    const record = await db.first(`${customerSelect} WHERE id = ? AND workshop_id = ?`, id, auth.workshop_id);
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

const vehicleSelect = `
  SELECT v.id, v.vehicle_code, v.workshop_id, v.customer_id,
    v.plate AS registration_number, v.plate, v.make, v.model,
    v.model_year AS manufacturing_year, v.model_year, v.color AS colour, v.color,
    v.vin AS chassis_number, v.engine_number, v.mileage,
    v.created_at, v.updated_at,
    c.customer_code AS owner_customer_code,
    c.display_name AS owner_name,
    c.phone AS owner_phone,
    c.email AS owner_email
  FROM vehicles v
  JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
`;

function requireVehicleStaff(auth: AuthContext): void {
  requireCustomerStaff(auth);
}

function normalizedRegistration(value: unknown): { plate: string; normalized: string } {
  const plate = requiredText(value, 'Registration number', 3, 24).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ./-]{1,22}[A-Z0-9]$/.test(plate)) {
    throw new HttpError(400, 'Enter a valid registration number using letters, numbers, spaces, hyphens, periods, or slashes.');
  }
  const normalized = plate.replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 3 || normalized.length > 20) {
    throw new HttpError(400, 'Registration number must contain between 3 and 20 letters or numbers.');
  }
  return { plate, normalized };
}

function validateVehicleFields(body: Record<string, unknown>, requireCustomer: boolean) {
  const allowedFields = [
    'customer_id', 'registration_number', 'plate', 'make', 'model',
    'manufacturing_year', 'model_year', 'colour', 'color', 'chassis_number',
    'vin', 'engine_number', 'mileage',
  ];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new HttpError(400, 'The request contains unsupported vehicle fields.');
  }
  const rawCustomerId = body.customer_id;
  const customerId = requireCustomer
    ? requiredText(rawCustomerId, 'Customer', 1, 36)
    : undefined;
  if (!requireCustomer && rawCustomerId !== undefined) {
    throw new HttpError(400, 'Vehicle ownership cannot be changed here.');
  }
  const plateValue = body.registration_number ?? body.plate;
  const registration = normalizedRegistration(plateValue);
  const make = requiredText(body.make, 'Vehicle make', 1, 80);
  const model = requiredText(body.model, 'Vehicle model', 1, 100);
  const yearValue = body.manufacturing_year ?? body.model_year;
  const year = typeof yearValue === 'number' && Number.isSafeInteger(yearValue)
    ? yearValue
    : Number.NaN;
  if (!Number.isInteger(year) || year < 1886 || year > new Date().getFullYear() + 1) {
    throw new HttpError(400, 'Manufacturing year must be a valid whole number.');
  }
  const mileageValue = body.mileage === undefined || body.mileage === null || body.mileage === ''
    ? 0
    : body.mileage;
  if (typeof mileageValue !== 'number' || !Number.isSafeInteger(mileageValue) || mileageValue < 0 || mileageValue > 2_000_000) {
    throw new HttpError(400, 'Mileage must be a non-negative whole number.');
  }
  const color = optionalCustomerText(body.colour ?? body.color, 'Colour', 50);
  const chassisNumber = optionalCustomerText(body.chassis_number ?? body.vin, 'Chassis number', 50);
  const engineNumber = optionalCustomerText(body.engine_number, 'Engine number', 80);
  return {
    customerId,
    ...registration,
    make,
    model,
    year,
    color,
    chassisNumber,
    engineNumber,
    mileage: mileageValue,
  };
}

async function getVehicleById(id: string, workshopId: string, technician?: AuthContext) {
  const scope = technician
    ? ` AND EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.vehicle_id = v.id AND j.workshop_id = v.workshop_id
          AND j.assigned_technician IN (?, ?)
      )`
    : '';
  const values = technician
    ? [id, workshopId, technician.name, technician.id]
    : [id, workshopId];
  return await db.first(`
    ${vehicleSelect}
    WHERE v.id = ? AND v.workshop_id = ?${scope}
  `, ...values);
}

async function findVehicleByRegistration(workshopId: string, normalized: string, excludeId?: string) {
  const exclude = excludeId ? ' AND v.id != ?' : '';
  const bindings = excludeId
    ? [workshopId, normalized, excludeId]
    : [workshopId, normalized];
  return await db.first(`
    ${vehicleSelect}
    WHERE v.workshop_id = ? AND v.registration_normalized = ?${exclude}
    LIMIT 1
  `, ...bindings);
}

function isVehicleUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

app.get('/api/vehicles/search', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (!query || query.length > 200) throw new HttpError(400, 'Enter a search term of 1 to 200 characters.');
    const like = `%${query}%`;
    const registration = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const phoneDigits = query.replace(/\D/g, '');
    const conditions = [
      'v.workshop_id = ?',
      `(
        v.id LIKE ? OR v.vehicle_code LIKE ? OR v.registration_normalized LIKE ?
        OR v.make LIKE ? OR v.model LIKE ?
        OR c.display_name LIKE ? OR c.phone LIKE ?
        OR (? != '' AND c.phone_normalized LIKE ?)
      )`,
    ];
    const bindings: (string | number)[] = [
      auth.workshop_id, like, like, `%${registration}%`, like, like, like, like,
      phoneDigits, `%${phoneDigits}%`,
    ];
    if (auth.role === 'technician') {
      conditions.push(`EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.vehicle_id = v.id AND j.workshop_id = v.workshop_id
          AND j.assigned_technician IN (?, ?)
      )`);
      bindings.push(auth.name, auth.id);
    } else {
      requireVehicleStaff(auth);
    }
    const records = await db.query(`
      ${vehicleSelect}
      WHERE ${conditions.join(' AND ')}
      ORDER BY v.created_at DESC
      LIMIT 50
    `, ...bindings);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/vehicles', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 100 and a non-negative offset.');
    }
    const sortFields: Record<string, string> = {
      registration_number: 'v.registration_normalized',
      make: 'v.make',
      model: 'v.model',
      manufacturing_year: 'v.model_year',
      owner_name: 'c.display_name',
      created_at: 'v.created_at',
    };
    const sort = typeof request.query.sort === 'string' ? request.query.sort : 'created_at';
    const order = typeof request.query.order === 'string' ? request.query.order.toLowerCase() : 'desc';
    if (!Object.hasOwn(sortFields, sort) || !['asc', 'desc'].includes(order)) {
      throw new HttpError(400, 'Vehicle sorting options are invalid.');
    }
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length > 200) throw new HttpError(400, 'Search terms cannot exceed 200 characters.');
    const conditions = ['v.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (query) {
      const like = `%${query}%`;
      const registration = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const phoneDigits = query.replace(/\D/g, '');
      conditions.push(`(
        v.id LIKE ? OR v.vehicle_code LIKE ? OR v.registration_normalized LIKE ?
        OR v.make LIKE ? OR v.model LIKE ?
        OR c.display_name LIKE ? OR c.phone LIKE ?
        OR (? != '' AND c.phone_normalized LIKE ?)
      )`);
      bindings.push(like, like, `%${registration}%`, like, like, like, like, phoneDigits, `%${phoneDigits}%`);
    }
    if (auth.role === 'technician') {
      conditions.push(`EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.vehicle_id = v.id AND j.workshop_id = v.workshop_id
          AND j.assigned_technician IN (?, ?)
      )`);
      bindings.push(auth.name, auth.id);
    } else {
      requireVehicleStaff(auth);
    }
    const where = conditions.join(' AND ');
    const total = (await db.first(`
      SELECT COUNT(*) AS total FROM vehicles v
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE ${where}
    `, ...bindings) as { total: number }).total;
    const registeredTotal = (await db.first(`
      SELECT COUNT(*) AS total FROM vehicles v
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE v.workshop_id = ?${auth.role === 'technician' ? ` AND EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.vehicle_id = v.id AND j.workshop_id = v.workshop_id
          AND j.assigned_technician IN (?, ?)
      )` : ''}
    `, auth.workshop_id,
      ...(auth.role === 'technician' ? [auth.name, auth.id] : [])) as { total: number }).total;
    const records = await db.query(`
      ${vehicleSelect}
      WHERE ${where}
      ORDER BY ${sortFields[sort]} ${order.toUpperCase()}, v.created_at DESC
      LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({ records, total, registeredTotal, limit, offset });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customers/:id/vehicles', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireVehicleStaff(auth);
    const customer = await db.first(`
      SELECT id FROM customers WHERE id = ? AND workshop_id = ?
    `, request.params.id, auth.workshop_id);
    if (!customer) throw new HttpError(404, 'Customer not found.');
    const records = await db.query(`
      ${vehicleSelect}
      WHERE v.customer_id = ? AND v.workshop_id = ?
      ORDER BY v.created_at DESC
    `, request.params.id, auth.workshop_id);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/vehicles/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (auth.role !== 'technician') requireVehicleStaff(auth);
    const record = await getVehicleById(
      request.params.id,
      auth.workshop_id,
      auth.role === 'technician' ? auth : undefined
    );
    if (!record) throw new HttpError(404, 'Vehicle not found.');
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/vehicles', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireVehicleStaff(auth);
    const values = validateVehicleFields(requireObject(request.body), true);
    const customerId = values.customerId;
    if (!customerId) throw new HttpError(400, 'Select an existing customer in this workshop.');
    const customer = await db.first(`
      SELECT id FROM customers WHERE id = ? AND workshop_id = ?
    `, customerId, auth.workshop_id);
    if (!customer) throw new HttpError(400, 'Select an existing customer in this workshop.');
    const duplicate = await findVehicleByRegistration(auth.workshop_id, values.normalized);
    if (duplicate) {
      response.status(409).json({
        error: 'duplicate_vehicle',
        message: 'A vehicle with this registration number already exists.',
        record: duplicate,
      });
      return;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      await db.execute(`
        INSERT INTO vehicles (
          id, workshop_id, customer_id, vehicle_code, plate, registration_normalized,
          vin, engine_number, make, model, model_year, color, mileage, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, auth.workshop_id, customerId, `VEH-${id.toUpperCase()}`,
        values.plate, values.normalized, values.chassisNumber, values.engineNumber,
        values.make, values.model, values.year, values.color, values.mileage, now, now);
    } catch (error) {
      if (!isVehicleUniqueConflict(error)) throw error;
      const matching = await findVehicleByRegistration(auth.workshop_id, values.normalized);
      response.status(409).json({
        error: 'duplicate_vehicle',
        message: 'A vehicle with this registration number already exists.',
        record: matching,
      });
      return;
    }
    response.status(201).json({ record: await getVehicleById(id, auth.workshop_id) });
  } catch (error) {
    next(error);
  }
}));

app.put('/api/vehicles/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireVehicleStaff(auth);
    const id = request.params.id;
    if (!await db.first('SELECT 1 FROM vehicles WHERE id = ? AND workshop_id = ?', id, auth.workshop_id)) {
      throw new HttpError(404, 'Vehicle not found.');
    }
    const values = validateVehicleFields(requireObject(request.body), false);
    const duplicate = await findVehicleByRegistration(auth.workshop_id, values.normalized, id);
    if (duplicate) {
      response.status(409).json({
        error: 'duplicate_vehicle',
        message: 'Another vehicle already uses this registration number.',
        record: duplicate,
      });
      return;
    }
    try {
      await db.execute(`
        UPDATE vehicles
        SET plate = ?, registration_normalized = ?, make = ?, model = ?,
          model_year = ?, color = ?, vin = ?, engine_number = ?, mileage = ?, updated_at = ?
        WHERE id = ? AND workshop_id = ?
      `, values.plate, values.normalized, values.make, values.model, values.year,
        values.color, values.chassisNumber, values.engineNumber, values.mileage,
        new Date().toISOString(), id, auth.workshop_id);
    } catch (error) {
      if (!isVehicleUniqueConflict(error)) throw error;
      const matching = await findVehicleByRegistration(auth.workshop_id, values.normalized, id);
      response.status(409).json({
        error: 'duplicate_vehicle',
        message: 'Another vehicle already uses this registration number.',
        record: matching,
      });
      return;
    }
    response.json({ record: await getVehicleById(id, auth.workshop_id) });
  } catch (error) {
    next(error);
  }
}));

const REPAIR_STATUSES = [
  'Received',
  'Awaiting Inspection',
  'Under Inspection',
  'Awaiting Customer Approval',
  'Approved',
  'In Progress',
  'Awaiting Spare Parts',
  'Repair Completed',
  'Ready for Collection',
  'Collected',
] as const;
type RepairStatus = typeof REPAIR_STATUSES[number];
const REPAIR_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const;
const SERVICE_TYPES = [
  'General Servicing',
  'Engine Repair',
  'Brake System Repair',
  'Suspension Repair',
  'Electrical Repair',
  'Transmission Repair',
  'Tyre and Wheel Service',
  'Other',
] as const;
const STATUS_TRANSITIONS: Record<RepairStatus, readonly RepairStatus[]> = {
  Received: ['Awaiting Inspection'],
  'Awaiting Inspection': ['Under Inspection', 'Awaiting Customer Approval', 'Approved'],
  'Under Inspection': ['Awaiting Customer Approval', 'Approved'],
  'Awaiting Customer Approval': ['Approved'],
  Approved: ['In Progress'],
  'In Progress': ['Awaiting Spare Parts', 'Repair Completed'],
  'Awaiting Spare Parts': ['In Progress', 'Repair Completed'],
  'Repair Completed': ['Ready for Collection', 'In Progress'],
  'Ready for Collection': ['Collected', 'In Progress'],
  Collected: [],
};
const TECHNICIAN_STATUSES = new Set<RepairStatus>([
  'Under Inspection',
  'In Progress',
  'Awaiting Spare Parts',
  'Repair Completed',
]);

interface RepairJobRow {
  id: string;
  workshop_id: string;
  vehicle_id: string;
  job_no: string;
  tracking_number: string;
  service_type: string;
  issue_description: string | null;
  inspection_notes: string | null;
  repair_status: RepairStatus;
  repair_priority: typeof REPAIR_PRIORITIES[number];
  bay: string | null;
  assigned_technician: string | null;
  estimated_labour_cost_cents: number;
  estimated_parts_cost_cents: number;
  estimated_total_cost_cents: number;
  promised_at: string | null;
  expected_completion_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  vehicle_code: string | null;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number;
  assigned_mechanic_name: string | null;
  assigned_mechanic_id: string | null;
}

const repairSelect = `
  SELECT j.id, j.workshop_id, j.vehicle_id, j.job_no,
    j.job_no AS repair_job_code, j.tracking_number, j.service_type,
    j.issue_description AS reported_problem, j.issue_description,
    j.inspection_notes,
    COALESCE(j.repair_status, CASE j.status
      WHEN 'Pending' THEN 'Received'
      WHEN 'Awaiting Parts' THEN 'Awaiting Spare Parts'
      WHEN 'Quality Check' THEN 'Repair Completed'
      WHEN 'Completed' THEN 'Ready for Collection'
      ELSE j.status
    END) AS repair_status,
    COALESCE(j.repair_priority, CASE j.priority
      WHEN 'urgent' THEN 'Urgent'
      WHEN 'high' THEN 'High'
      ELSE 'Normal'
    END) AS repair_priority,
    j.bay,
    j.assigned_technician,
    COALESCE(j.estimated_labour_cost_cents, 0) AS estimated_labour_cost_cents,
    COALESCE(j.estimated_parts_cost_cents, 0) AS estimated_parts_cost_cents,
    CASE
      WHEN COALESCE(j.estimated_total_cost_cents, 0) = 0 THEN j.estimated_amount_cents
      ELSE j.estimated_total_cost_cents
    END AS estimated_total_cost_cents,
    j.promised_at AS expected_completion_date,
    j.promised_at, j.notes AS additional_notes, j.notes,
    j.created_at AS date_received, j.created_at, j.updated_at,
    (
      SELECT history.previous_status
      FROM repair_status_history history
      WHERE history.job_id = j.id AND history.workshop_id = j.workshop_id
      ORDER BY history.changed_at DESC, history.id DESC
      LIMIT 1
    ) AS previous_status,
    (
      SELECT history.changed_at
      FROM repair_status_history history
      WHERE history.job_id = j.id AND history.workshop_id = j.workshop_id
      ORDER BY history.changed_at DESC, history.id DESC
      LIMIT 1
    ) AS last_status_changed_at,
    (
      SELECT COALESCE(activity.work_performed, activity.inspection_findings,
        activity.problems_identified, activity.recommendations,
        activity.additional_work_required)
      FROM repair_activity_logs activity
      WHERE activity.job_id = j.id AND activity.workshop_id = j.workshop_id
      ORDER BY activity.created_at DESC, activity.id DESC
      LIMIT 1
    ) AS latest_activity_note,
    (
      SELECT activity.created_at
      FROM repair_activity_logs activity
      WHERE activity.job_id = j.id AND activity.workshop_id = j.workshop_id
      ORDER BY activity.created_at DESC, activity.id DESC
      LIMIT 1
    ) AS last_activity_at,
    c.id AS customer_id, c.customer_code, c.display_name AS customer_name,
    c.phone AS customer_phone, c.email AS customer_email,
    v.vehicle_code, v.plate AS registration_number, v.make, v.model,
    v.model_year AS manufacturing_year,
    u.id AS assigned_mechanic_id, u.name AS assigned_mechanic_name
  FROM jobs j
  JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
  JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
  LEFT JOIN users u ON u.id = (
    SELECT assigned.id FROM users assigned
    WHERE assigned.workshop_id = j.workshop_id
      AND (assigned.id = j.assigned_technician OR assigned.name = j.assigned_technician)
    LIMIT 1
  )
`;

function requireRepairStaff(auth: AuthContext): void {
  if (!isStaffRole(auth.role)) throw new HttpError(403, 'role_forbidden');
}

interface DiagnosisCandidate {
  fault_category: string;
  confidence: number;
  dtc_reference: string;
  possible_causes?: string[];
  inspection_procedures: string[];
}

interface DiagnosisPrediction {
  predictions: DiagnosisCandidate[];
  model: string;
  model_version?: string;
  library_version?: string;
  generated_at?: string;
  warning: string;
  data_limitations?: string;
  context_used?: { fields: string[]; dtc_codes: string[]; note: string };
}

interface DiagnosisContext {
  included: boolean;
  dtcCodes: string[];
  vehicle: Record<string, unknown>;
  recentRepairs: Record<string, unknown>[];
  recentInspections: Record<string, unknown>[];
  note: string;
  model_context?: Record<string, unknown>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
}

function runDiagnosisPrediction(symptoms: string, modelContext?: Record<string, unknown>): Promise<DiagnosisPrediction> {
  return new Promise((resolvePrediction, rejectPrediction) => {
    const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, [resolve(process.cwd(), 'ml', 'diagnosis.py'), 'predict'], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => rejectPrediction(new HttpError(503, 'The diagnosis model did not respond in time.')));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 512_000) child.kill();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_000);
    });
    child.on('error', () => {
      finish(() => rejectPrediction(new HttpError(503, 'Python could not start. Configure PYTHON_EXECUTABLE and install ml/requirements.txt.')));
    });
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code !== 0) {
        if (stderr.trim()) console.error('NEXTGEN diagnosis model failed:', stderr.trim());
        finish(() => rejectPrediction(new HttpError(503, 'The diagnosis model is unavailable. Install its dependencies and train it with python ml/diagnosis.py train.')));
        return;
      }
      try {
        const result = JSON.parse(stdout) as DiagnosisPrediction;
        if (!Array.isArray(result.predictions) || result.predictions.length === 0) {
          throw new Error('The model returned no diagnosis candidates.');
        }
        const valid = result.predictions.every((entry) =>
          entry && typeof entry.fault_category === 'string' && typeof entry.confidence === 'number'
          && Number.isFinite(entry.confidence) && entry.confidence >= 0 && entry.confidence <= 1
          && isStringArray(entry.inspection_procedures)
          && (entry.possible_causes === undefined || isStringArray(entry.possible_causes)));
        if (!valid) throw new Error('The model returned malformed diagnosis candidates.');
        finish(() => resolvePrediction(result));
      } catch {
        finish(() => rejectPrediction(new HttpError(503, 'The diagnosis model returned an invalid response.')));
      }
    });
    child.stdin.end(JSON.stringify({ symptoms, context: modelContext ?? {} }));
  });
}

async function requireDiagnosisVehicleAccess(vehicleId: string, auth: AuthContext): Promise<{ customer_id: string }> {
  const vehicle = await db.first(`
    SELECT customer_id FROM vehicles WHERE id = ? AND workshop_id = ?
  `, vehicleId, auth.workshop_id) as { customer_id: string } | undefined;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
  if (auth.role === 'technician') {
    const assigned = await db.first(`
      SELECT 1 FROM jobs
      WHERE vehicle_id = ? AND workshop_id = ? AND assigned_technician IN (?, ?)
      LIMIT 1
    `, vehicleId, auth.workshop_id, auth.name, auth.id);
    if (!assigned) throw new HttpError(403, 'role_forbidden');
  } else {
    requireRepairStaff(auth);
  }
  return vehicle;
}

function extractDtcCodes(...texts: unknown[]): string[] {
  const codes = new Set<string>();
  for (const text of texts) {
    if (typeof text !== 'string') continue;
    for (const match of text.matchAll(/\b[PBCU][0-9]{4}\b/gi)) codes.add(match[0].toUpperCase());
  }
  return [...codes].slice(0, 12);
}

async function buildDiagnosisContext(
  vehicleId: string,
  symptoms: string,
  auth: AuthContext,
  includeContext: boolean,
): Promise<{ context: DiagnosisContext; classifierInput: string; modelContext: Record<string, unknown> }> {
  const vehicle = await db.first(`
    SELECT id, plate AS registration_number, make, model, model_year, mileage, vin, engine_number,
      catalogue_model_id, engine_type, engine_capacity_cc, fuel_type, transmission_type, drive_type
    FROM vehicles WHERE id = ? AND workshop_id = ?
  `, vehicleId, auth.workshop_id) as Record<string, unknown> | undefined;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found.');

  const context: DiagnosisContext = {
    included: includeContext,
    dtcCodes: [],
    vehicle,
    recentRepairs: [],
    recentInspections: [],
    note: includeContext
      ? 'Structured vehicle context and recorded DTC codes are passed to the Python model and saved with the prediction. The Python service appends DTC codes to the symptom text once. The bundled training context is synthetic and has no validated diagnostic signal; output remains unreviewed until a mechanic confirms it.'
      : 'Vehicle context inclusion was disabled for this request. Only the entered symptom text was sent to the model.',
  };
  const emptyModelContext: Record<string, unknown> = {};
  if (!includeContext) {
    context.model_context = emptyModelContext;
    return { context, classifierInput: symptoms, modelContext: emptyModelContext };
  }

  let catalogueSpecification: Record<string, unknown> | undefined;
  const needsCatalogue = ['engine_type', 'fuel_type', 'transmission_type', 'drive_type']
    .some((field) => vehicle[field] === null || vehicle[field] === undefined || vehicle[field] === '');
  if (needsCatalogue) {
    let catalogueModel = vehicle.catalogue_model_id
      ? await db.first('SELECT id FROM vehicle_models WHERE id = ?', String(vehicle.catalogue_model_id))
      : await db.first(`
          SELECT vm.id
          FROM vehicle_models vm JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
          WHERE LOWER(m.name) = LOWER(?) AND LOWER(vm.name) = LOWER(?)
          LIMIT 1
        `, String(vehicle.make ?? ''), String(vehicle.model ?? ''));
    if (!catalogueModel) {
      const central = resolveCatalogueModel(String(vehicle.make ?? ''), String(vehicle.model ?? ''));
      if (central) catalogueModel = await db.first('SELECT id FROM vehicle_models WHERE id = ?', central.id);
    }
    if (catalogueModel) {
      catalogueSpecification = await db.first(`
        SELECT engine_type, engine_capacity_cc, fuel_type, transmission_type, drive_type, verification_status
        FROM vehicle_specifications
        WHERE model_id = ? AND verification_status != 'not_recorded'
        ORDER BY id DESC LIMIT 1
      `, String((catalogueModel as Record<string, unknown>).id)) as Record<string, unknown> | undefined;
    }
  }
  const contextValue = (field: string): string => {
    const value = vehicle[field] ?? catalogueSpecification?.[field];
    if (value === null || value === undefined || value === '') return 'Not recorded';
    return typeof value === 'string' && value.trim().length === 0 ? 'Not recorded' : String(value);
  };

  const repairs = await db.query(`
    SELECT id, job_no AS repair_job_code, service_type, issue_description,
      inspection_notes, notes, repair_status, created_at
    FROM jobs WHERE vehicle_id = ? AND workshop_id = ?
    ORDER BY created_at DESC LIMIT 5
  `, vehicleId, auth.workshop_id) as Record<string, unknown>[];
  const inspections = await db.query(`
    SELECT component_name, condition_status, inspection_notes, inspection_date, inspected_by_name
    FROM vehicle_component_inspections WHERE vehicle_id = ? AND workshop_id = ?
    ORDER BY inspection_date DESC LIMIT 5
  `, vehicleId, auth.workshop_id) as Record<string, unknown>[];
  context.recentRepairs = repairs;
  context.recentInspections = inspections;
  context.dtcCodes = extractDtcCodes(
    ...repairs.flatMap((repair) => [repair.issue_description, repair.inspection_notes, repair.notes]),
    ...inspections.map((inspection) => inspection.inspection_notes),
  );
  const joinParts = (parts: unknown[]): string => parts
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(' | ')
    .slice(0, 300) || 'Not recorded';
  const engineCapacity = vehicle.engine_capacity_cc ?? catalogueSpecification?.engine_capacity_cc ?? null;
  const recordedEngine = contextValue('engine_type');
  const engineDescription = engineCapacity !== null && engineCapacity !== undefined
    ? `${recordedEngine} (${engineCapacity} cc)`
    : recordedEngine;
  const modelContext: Record<string, unknown> = {
    manufacturer: contextValue('make'),
    model: contextValue('model'),
    model_year: vehicle.model_year ?? 0,
    mileage: vehicle.mileage ?? 0,
    engine_type: engineDescription,
    fuel_type: contextValue('fuel_type'),
    transmission_type: contextValue('transmission_type'),
    drive_type: contextValue('drive_type'),
    inspection_findings: joinParts(inspections.map((inspection) => [inspection.condition_status, inspection.inspection_notes].join(': '))),
    previous_faults: joinParts(repairs.map((repair) => [repair.service_type, repair.issue_description].join(': '))),
    dtc_codes: context.dtcCodes,
  };
  context.model_context = modelContext;

  // The Python service appends extracted DTC codes to the symptom text from
  // modelContext.dtc_codes. Keeping classifierInput as the mechanic's own text
  // avoids duplicating those codes in the TF-IDF field.
  return { context, classifierInput: symptoms, modelContext };
}

function diagnosisPredictionRows(rows: Record<string, unknown>[]): (Record<string, unknown> & SmartWorkshopPrediction)[] {
  return rows.map((row) => ({
    ...row,
    affected_component: typeof row.affected_component === 'string' ? row.affected_component : null,
    predicted_fault: String(row.predicted_fault ?? ''),
    confirmed_fault: typeof row.confirmed_fault === 'string' ? row.confirmed_fault : null,
    review_status: String(row.review_status ?? 'pending'),
    confidence: Number(row.confidence ?? 0),
    created_at: String(row.created_at ?? ''),
  })) as (Record<string, unknown> & SmartWorkshopPrediction)[];
}

function isRepairStatus(value: unknown): value is RepairStatus {
  return typeof value === 'string' && (REPAIR_STATUSES as readonly string[]).includes(value);
}

function legacyRepairStatus(status: RepairStatus): string {
  if (status === 'In Progress') return 'In Progress';
  if (status === 'Awaiting Spare Parts') return 'Awaiting Parts';
  if (status === 'Repair Completed') return 'Quality Check';
  if (status === 'Ready for Collection' || status === 'Collected') return 'Completed';
  return 'Pending';
}

function repairStatusFromLegacy(status: string): RepairStatus {
  if (status === 'Pending') return 'Received';
  if (status === 'Awaiting Parts') return 'Awaiting Spare Parts';
  if (status === 'Quality Check') return 'Repair Completed';
  if (status === 'Completed') return 'Ready for Collection';
  if (status === 'In Progress') return 'In Progress';
  throw new HttpError(400, 'Legacy repair status is invalid.');
}

function legacyRepairPriority(priority: typeof REPAIR_PRIORITIES[number]): string {
  if (priority === 'Urgent') return 'urgent';
  if (priority === 'High') return 'high';
  return 'standard';
}

async function repairJob(id: string, workshopId: string, technician?: AuthContext): Promise<RepairJobRow | undefined> {
  const technicianScope = technician
    ? ` AND j.assigned_technician IN (?, ?)`
    : '';
  const bindings = technician
    ? [id, workshopId, technician.name, technician.id]
    : [id, workshopId];
  return await db.first(`
    ${repairSelect}
    WHERE j.id = ? AND j.workshop_id = ?${technicianScope}
  `, ...bindings) as RepairJobRow | undefined;
}

async function requireRepairAccess(id: string, auth: AuthContext): Promise<RepairJobRow> {
  if (auth.role === 'technician') {
    const assigned = await repairJob(id, auth.workshop_id, auth);
    if (!assigned) throw new HttpError(404, 'Repair job not found.');
    return assigned;
  }
  requireRepairStaff(auth);
  const record = await repairJob(id, auth.workshop_id);
  if (!record) throw new HttpError(404, 'Repair job not found.');
  return record;
}

function nonNegativeCost(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new HttpError(400, `${label} must be a non-negative amount in cents.`);
  }
  return value;
}

function validDate(value: unknown, label: string, nullable = false): string | null {
  if ((value === null || value === '') && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} is not a valid date.`);
  }
  return value;
}

function validateRepairFields(body: Record<string, unknown>, creating: boolean) {
  const allowed = [
    ...(creating ? ['customer_id', 'vehicle_id', 'diagnosis_id'] : []),
    'service_type', 'reported_problem',
    'inspection_notes', 'repair_priority', 'expected_completion_date',
    'estimated_labour_cost_cents', 'estimated_parts_cost_cents', 'bay',
    'additional_notes', 'status_note', 'assigned_mechanic_id',
  ];
  if (Object.keys(body).some((field) => !allowed.includes(field))) {
    throw new HttpError(400, 'The request contains unsupported repair job fields.');
  }
  const customerId = creating ? requiredText(body.customer_id, 'Customer', 1, 36) : undefined;
  const vehicleId = creating ? requiredText(body.vehicle_id, 'Vehicle', 1, 36) : undefined;
  const diagnosisId = creating && body.diagnosis_id !== undefined
    ? requiredText(body.diagnosis_id, 'Diagnosis', 1, 36)
    : undefined;
  const serviceType = body.service_type === undefined && !creating
    ? undefined
    : requiredText(body.service_type, 'Service type', 1, 160);
  const problem = body.reported_problem === undefined && !creating
    ? undefined
    : requiredText(body.reported_problem, 'Reported problem', 1, 4000);
  let priority: typeof REPAIR_PRIORITIES[number] | undefined;
  if (body.repair_priority !== undefined) {
    if (typeof body.repair_priority !== 'string' ||
        !(REPAIR_PRIORITIES as readonly string[]).includes(body.repair_priority)) {
      throw new HttpError(400, 'Repair priority is invalid.');
    }
    priority = body.repair_priority as typeof REPAIR_PRIORITIES[number];
  } else if (creating) {
    priority = 'Normal';
  }
  const mechanicId = body.assigned_mechanic_id === undefined
    ? undefined
    : optionalCustomerText(body.assigned_mechanic_id, 'Assigned mechanic', 36);
  const bay = body.bay === undefined
    ? undefined
    : optionalCustomerText(body.bay, 'Workshop bay', 80);
  const receivedDate = creating
    ? new Date().toISOString().slice(0, 10)
    : undefined;
  const expectedDate = body.expected_completion_date === undefined
    ? (creating ? null : undefined)
    : validDate(body.expected_completion_date, 'Expected completion date', true);
  if (expectedDate && receivedDate && expectedDate < receivedDate) {
    throw new HttpError(400, 'Expected completion date cannot be before the received date.');
  }
  const labourCost = body.estimated_labour_cost_cents === undefined
    ? (creating ? 0 : undefined)
    : nonNegativeCost(body.estimated_labour_cost_cents, 'Estimated labour cost');
  const partsCost = body.estimated_parts_cost_cents === undefined
    ? (creating ? 0 : undefined)
    : nonNegativeCost(body.estimated_parts_cost_cents, 'Estimated parts cost');
  const inspectionNotes = body.inspection_notes === undefined
    ? undefined
    : optionalCustomerText(body.inspection_notes, 'Inspection notes', 4000);
  const notes = body.additional_notes === undefined
    ? undefined
    : optionalCustomerText(body.additional_notes, 'Additional notes', 4000);
  const statusNote = body.status_note === undefined
    ? undefined
    : optionalCustomerText(body.status_note, 'Status update note', 2000);
  return {
    customerId,
    vehicleId,
    diagnosisId,
    serviceType,
    problem,
    inspectionNotes,
    priority,
    mechanicId,
    bay,
    expectedDate,
    labourCost,
    partsCost,
    notes,
    statusNote,
  };
}

function validateRepairDates(received: string, expected: string | null): void {
  if (expected && expected < received.slice(0, 10)) {
    throw new HttpError(400, 'Expected completion date cannot be before the received date.');
  }
}

/** Customer-safe notifications are derived only from repair statuses already recorded by staff. */
async function createCustomerStatusNotification(
  jobId: string,
  workshopId: string,
  status: string,
  createdAt: string
): Promise<void> {
  const template = customerNotificationTemplate(status);
  if (!template) return;
  try {
    const job = await db.first(`
      SELECT v.customer_id
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE j.id = ? AND j.workshop_id = ?
    `, jobId, workshopId) as { customer_id: string } | undefined;
    if (!job) return;
    await db.execute(`
      INSERT IGNORE INTO customer_notifications (
        id, workshop_id, customer_id, job_id, event_key, type, title, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, randomUUID(), workshopId, job.customer_id, jobId,
      `status:${status}:${createdAt}:${jobId}`, template.type, template.title, template.message, createdAt);
  } catch (error) {
    // A notification failure must never roll back a legitimate workshop repair update.
    console.error('Unable to create customer repair notification:', error);
  }
}

async function insertRepairStatusHistory(
  jobId: string,
  workshopId: string,
  previousStatus: RepairStatus | null,
  newStatus: RepairStatus,
  note: string | null,
  auth: AuthContext,
  changedAt: string
): Promise<void> {
  await db.execute(`
    INSERT INTO repair_status_history (
      id, workshop_id, job_id, previous_status, new_status, note,
      changed_by_user_id, changed_by_name, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, randomUUID(), workshopId, jobId, previousStatus, newStatus, note, auth.id, auth.name, changedAt);
  await createCustomerStatusNotification(jobId, workshopId, newStatus, changedAt);
}

// Shared status transition used by Service & Repair, Workshop Floor Live, and mechanic work management.
// The repair job remains the single source of truth for repair status.
async function changeRepairStatus(
  existing: RepairJobRow,
  nextStatus: RepairStatus,
  note: string | null,
  auth: AuthContext,
  changedAt: string
): Promise<void> {
  const previousStatus = existing.repair_status;
  if (nextStatus === previousStatus) throw new HttpError(400, 'The repair job already has that status.');
  if (!STATUS_TRANSITIONS[previousStatus].includes(nextStatus)) {
    throw new HttpError(409, `The status cannot move from ${previousStatus} to ${nextStatus}.`);
  }
  if (auth.role === 'technician' && !TECHNICIAN_STATUSES.has(nextStatus)) {
    throw new HttpError(403, 'Mechanics cannot set this repair status.');
  }
  await db.execute(`
    UPDATE jobs SET repair_status = ?, status = ?, updated_at = ?
    WHERE id = ? AND workshop_id = ?
  `, nextStatus, legacyRepairStatus(nextStatus), changedAt, existing.id, auth.workshop_id);
  await insertRepairStatusHistory(existing.id, auth.workshop_id, previousStatus, nextStatus, note, auth, changedAt);
}

interface RepairActivityInput {
  workshopId: string;
  jobId: string;
  fields: Record<string, string | null>;
  activityType?: string | null;
  workStatus?: string | null;
  auth: AuthContext;
  createdAt: string;
}

// All repair work logs, regardless of which module records them, use this single table.
async function insertRepairActivity(input: RepairActivityInput): Promise<Record<string, unknown>> {
  const id = randomUUID();
  await db.execute(`
    INSERT INTO repair_activity_logs (
      id, workshop_id, job_id, work_performed, inspection_findings,
      problems_identified, recommendations, additional_work_required,
      internal_notes, activity_type, work_status,
      created_by_user_id, created_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, input.workshopId, input.jobId,
    input.fields.work_performed ?? null, input.fields.inspection_findings ?? null,
    input.fields.problems_identified ?? null, input.fields.recommendations ?? null,
    input.fields.additional_work_required ?? null, input.fields.internal_notes ?? null,
    input.activityType ?? null, input.workStatus ?? null,
    input.auth.id, input.auth.name, input.createdAt);
  return (await db.first('SELECT * FROM repair_activity_logs WHERE id = ?', id)) as Record<string, unknown>;
}

async function assignRepairMechanic(
  jobId: string,
  workshopId: string,
  mechanicId: string | null,
  auth: AuthContext,
  assignedAt: string
): Promise<void> {
  const current = await db.first(`
    SELECT id, role FROM users
    WHERE id = ? AND workshop_id = ?
  `, mechanicId ?? '', workshopId) as { id: string; role: string } | undefined;
  if (mechanicId && (!current || current.role !== 'technician')) {
    throw new HttpError(400, 'Select an existing mechanic account from this workshop.');
  }
  const previous = await db.first(`
    SELECT id FROM repair_mechanic_assignments
    WHERE job_id = ? AND workshop_id = ? AND unassigned_at IS NULL
  `, jobId, workshopId) as { id: string } | undefined;
  if (previous) {
    await db.execute(`UPDATE repair_mechanic_assignments
      SET unassigned_at = ?, assignment_status = 'cancelled' WHERE id = ?`, assignedAt, previous.id);
  }
  await db.execute(`
    UPDATE jobs SET assigned_technician = ?, updated_at = ?
    WHERE id = ? AND workshop_id = ?
  `, mechanicId, assignedAt, jobId, workshopId);
  if (mechanicId && current) {
    const mechanic = await db.first(`
      SELECT name FROM users WHERE id = ? AND workshop_id = ?
    `, mechanicId, workshopId) as { name: string };
    await db.execute(`
      INSERT INTO repair_mechanic_assignments (
        id, workshop_id, job_id, mechanic_user_id, mechanic_name,
        assigned_by_user_id, assigned_by_name, assigned_at, unassigned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `, randomUUID(), workshopId, jobId, mechanicId, mechanic.name, auth.id, auth.name, assignedAt);
  }
}

function repairFilters(request: express.Request, auth: AuthContext) {
  const conditions = ['j.workshop_id = ?'];
  const bindings: (string | number)[] = [auth.workshop_id];
  if (auth.role === 'technician') {
    conditions.push('j.assigned_technician IN (?, ?)');
    bindings.push(auth.name, auth.id);
  } else {
    requireRepairStaff(auth);
  }
  const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
  if (q.length > 200) throw new HttpError(400, 'Search terms cannot exceed 200 characters.');
  if (q) {
    const like = `%${q}%`;
    conditions.push(`(
      j.id LIKE ? OR j.job_no LIKE ? OR j.tracking_number LIKE ?
      OR c.display_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
      OR v.plate LIKE ? OR v.vehicle_code LIKE ? OR v.make LIKE ? OR v.model LIKE ?
      OR u.name LIKE ? OR j.assigned_technician LIKE ?
    )`);
    bindings.push(like, like, like, like, like, like, like, like, like, like, like, like);
  }
  const filterMap = [
    { query: 'status', column: 'j.repair_status', allowed: REPAIR_STATUSES as readonly string[] },
    { query: 'service_type', column: 'j.service_type', allowed: SERVICE_TYPES as readonly string[] },
    { query: 'priority', column: 'j.repair_priority', allowed: REPAIR_PRIORITIES as readonly string[] },
  ];
  for (const filter of filterMap) {
    const value = request.query[filter.query];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !filter.allowed.includes(value)) {
      throw new HttpError(400, `The ${filter.query.replaceAll('_', ' ')} filter is invalid.`);
    }
    conditions.push(`${filter.column} = ?`);
    bindings.push(value);
  }
  if (typeof request.query.mechanic_id === 'string' && request.query.mechanic_id) {
    conditions.push('j.assigned_technician = ?');
    bindings.push(request.query.mechanic_id);
  }
  const dateFrom = request.query.date_from === undefined ? null : validDate(request.query.date_from, 'Start date');
  const dateTo = request.query.date_to === undefined ? null : validDate(request.query.date_to, 'End date');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new HttpError(400, 'Start date must be on or before end date.');
  if (dateFrom) {
    conditions.push('DATE(j.created_at) >= DATE(?)');
    bindings.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('DATE(j.created_at) <= DATE(?)');
    bindings.push(dateTo);
  }
  return { where: conditions.join(' AND '), bindings };
}

function repairSortField(value: unknown): string {
  const fields: Record<string, string> = {
    repair_job_code: 'j.job_no',
    tracking_number: 'j.tracking_number',
    customer_name: 'c.display_name',
    registration_number: 'v.plate',
    service_type: 'j.service_type',
    assigned_mechanic: 'assigned_mechanic_name',
    repair_priority: 'j.repair_priority',
    repair_status: 'j.repair_status',
    date_received: 'j.created_at',
    expected_completion_date: 'j.promised_at',
  };
  const key = typeof value === 'string' ? value : 'date_received';
  if (!Object.hasOwn(fields, key)) throw new HttpError(400, 'Repair job sorting option is invalid.');
  return fields[key];
}

async function repairSummary(workshopId: string, technician?: AuthContext) {
  const scope = technician ? ' AND assigned_technician IN (?, ?)' : '';
  const args = technician ? [workshopId, technician.name, technician.id] : [workshopId];
  const grouped = await db.query(`
    SELECT COALESCE(repair_status, status) AS repair_status, COUNT(*) AS count
    FROM jobs WHERE workshop_id = ?${scope}
    GROUP BY COALESCE(repair_status, status)
  `, ...args) as { repair_status: string; count: number }[];
  const counts = new Map(grouped.map((entry) => [entry.repair_status, entry.count]));
  return {
    total_repair_jobs: grouped.reduce((sum, entry) => sum + entry.count, 0),
    newly_received: counts.get('Received') ?? counts.get('Pending') ?? 0,
    awaiting_inspection: counts.get('Awaiting Inspection') ?? 0,
    in_progress: counts.get('In Progress') ?? 0,
    awaiting_spare_parts: counts.get('Awaiting Spare Parts') ?? counts.get('Awaiting Parts') ?? 0,
    completed_repairs: counts.get('Repair Completed') ?? counts.get('Quality Check') ?? 0,
    ready_for_collection:
      (counts.get('Ready for Collection') ?? 0) +
      (counts.get('Collected') ?? 0) +
      (counts.get('Completed') ?? 0),
  };
}

app.get('/api/workshop/floor', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (auth.role !== 'technician') requireRepairStaff(auth);

    const scope = auth.role === 'technician'
      ? ' AND j.assigned_technician IN (?, ?)'
      : '';
    const scopeBindings = auth.role === 'technician'
      ? [auth.name, auth.id]
      : [];
    const activeStatus = `COALESCE(j.repair_status, CASE j.status
      WHEN 'Pending' THEN 'Received'
      WHEN 'Awaiting Parts' THEN 'Awaiting Spare Parts'
      WHEN 'Quality Check' THEN 'Repair Completed'
      WHEN 'Completed' THEN 'Ready for Collection'
      ELSE j.status
    END)`;
    const activeRecords = await db.query(`
      ${repairSelect}
      WHERE j.workshop_id = ? AND ${activeStatus} != 'Collected'${scope}
      ORDER BY
        CASE COALESCE(j.repair_priority, CASE j.priority
          WHEN 'urgent' THEN 'Urgent'
          WHEN 'high' THEN 'High'
          ELSE 'Normal'
        END)
          WHEN 'Urgent' THEN 0
          WHEN 'High' THEN 1
          WHEN 'Normal' THEN 2
          ELSE 3
        END,
        j.created_at ASC
    `, auth.workshop_id, ...scopeBindings) as unknown as (RepairJobRow & {
      previous_status: RepairStatus | null;
      last_status_changed_at: string | null;
      latest_activity_note: string | null;
      last_activity_at: string | null;
    })[];

    const distinctVehicles = (status: RepairStatus) => new Set(
      activeRecords.filter((record) => record.repair_status === status).map((record) => record.vehicle_id)
    ).size;
    const summary = {
      total_vehicles_in_workshop: new Set(activeRecords.map((record) => record.vehicle_id)).size,
      newly_received: distinctVehicles('Received'),
      awaiting_inspection: distinctVehicles('Awaiting Inspection'),
      awaiting_customer_approval: distinctVehicles('Awaiting Customer Approval'),
      approved: distinctVehicles('Approved'),
      repairs_in_progress: distinctVehicles('In Progress'),
      awaiting_spare_parts: distinctVehicles('Awaiting Spare Parts'),
      completed_repairs: distinctVehicles('Repair Completed'),
      ready_for_collection: distinctVehicles('Ready for Collection'),
    };

    const groupedMechanics = new Map<string, {
      mechanic_id: string | null;
      mechanic_name: string;
      assigned_jobs: number;
      current_workload: number;
      active_repairs: number;
      completed_jobs: number;
    }>();
    for (const record of activeRecords) {
      if (!record.assigned_technician) continue;
      const mechanicKey = record.assigned_mechanic_id ?? record.assigned_technician;
      const mechanicName = record.assigned_mechanic_name ?? record.assigned_technician;
      const entry = groupedMechanics.get(mechanicKey) ?? {
        mechanic_id: record.assigned_mechanic_id,
        mechanic_name: mechanicName,
        assigned_jobs: 0,
        current_workload: 0,
        active_repairs: 0,
        completed_jobs: 0,
      };
      entry.assigned_jobs += 1;
      if (!['Repair Completed', 'Ready for Collection'].includes(record.repair_status)) {
        entry.current_workload += 1;
      } else {
        entry.completed_jobs += 1;
      }
      if (record.repair_status === 'In Progress') entry.active_repairs += 1;
      groupedMechanics.set(mechanicKey, entry);
    }
    const mechanics = [...groupedMechanics.values()]
      .sort((left, right) => left.mechanic_name.localeCompare(right.mechanic_name))
      .map((mechanic) => ({
        ...mechanic,
        workload_status: mechanic.current_workload > 0 ? 'Busy' : 'No active assignment',
      }));

    const bayRows = await db.query(`
      SELECT code AS name FROM workshop_bays
      WHERE workshop_id = ? AND is_active = 1
      UNION
      SELECT DISTINCT TRIM(bay) AS name
      FROM jobs
      WHERE workshop_id = ? AND bay IS NOT NULL AND TRIM(bay) <> ''
      ORDER BY name
    `, auth.workshop_id, auth.workshop_id) as { name: string }[];
    const bayOccupants = new Map<string, typeof activeRecords>();
    for (const record of activeRecords) {
      const bay = record.bay?.trim();
      if (!bay) continue;
      const bayKey = bay.toLowerCase();
      const occupants = bayOccupants.get(bayKey) ?? [];
      occupants.push(record);
      bayOccupants.set(bayKey, occupants);
    }
    const bays = bayRows.map(({ name }) => ({
      name,
      occupants: (bayOccupants.get(name.trim().toLowerCase()) ?? []).map((record) => ({
        id: record.id,
        repair_job_code: record.job_no,
        registration_number: record.registration_number,
        make: record.make,
        model: record.model,
        repair_status: record.repair_status,
        assigned_mechanic_name: record.assigned_mechanic_name ?? record.assigned_technician,
      })),
    }));

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const alerts = activeRecords.flatMap((record) => {
      const entries: {
        id: string;
        type: string;
        repair_job_id: string;
        repair_job_code: string;
        customer_name: string;
        registration_number: string;
        message: string;
      }[] = [];
      const common = {
        repair_job_id: record.id,
        repair_job_code: record.job_no,
        customer_name: record.customer_name,
        registration_number: record.registration_number,
      };
      if (record.repair_priority === 'Urgent') {
        entries.push({ ...common, id: `${record.id}:urgent`, type: 'urgent', message: 'Urgent repair priority' });
      }
      if (
        record.expected_completion_date &&
        record.expected_completion_date.slice(0, 10) < today &&
        !['Repair Completed', 'Ready for Collection'].includes(record.repair_status)
      ) {
        entries.push({ ...common, id: `${record.id}:overdue`, type: 'overdue', message: `Past expected completion (${record.expected_completion_date.slice(0, 10)})` });
      }
      if (record.repair_status === 'Awaiting Customer Approval') {
        entries.push({ ...common, id: `${record.id}:approval`, type: 'awaiting_approval', message: 'Awaiting customer approval' });
      }
      if (record.repair_status === 'Awaiting Spare Parts') {
        entries.push({ ...common, id: `${record.id}:parts`, type: 'awaiting_parts', message: 'Waiting for spare parts' });
      }
      if (record.repair_status === 'Ready for Collection') {
        entries.push({ ...common, id: `${record.id}:collection`, type: 'ready_for_collection', message: 'Ready for collection' });
      }
      if (!record.assigned_technician) {
        entries.push({ ...common, id: `${record.id}:unassigned`, type: 'unassigned', message: 'No mechanic is assigned' });
      }
      return entries;
    });

    const activityScope = auth.role === 'technician'
      ? ' AND j.assigned_technician IN (?, ?)'
      : '';
    const activityScopeBindings = auth.role === 'technician'
      ? [auth.name, auth.id]
      : [];
    const activities = await db.query(`
      SELECT id, repair_job_code, customer_name, registration_number,
        event_type, summary, actor_name, occurred_at
      FROM (
        SELECT h.id, j.job_no AS repair_job_code, c.display_name AS customer_name,
          v.plate AS registration_number, 'status' AS event_type,
          CONCAT('Status changed to ', h.new_status) AS summary,
          h.changed_by_name AS actor_name, h.changed_at AS occurred_at
        FROM repair_status_history h
        JOIN jobs j ON j.id = h.job_id AND j.workshop_id = h.workshop_id
        JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
        JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
        WHERE h.workshop_id = ?${activityScope}
        UNION ALL
        SELECT a.id, j.job_no AS repair_job_code, c.display_name AS customer_name,
          v.plate AS registration_number, 'activity' AS event_type,
          COALESCE(a.work_performed, a.inspection_findings, a.problems_identified,
            a.recommendations, a.additional_work_required) AS summary,
          a.created_by_name AS actor_name, a.created_at AS occurred_at
        FROM repair_activity_logs a
        JOIN jobs j ON j.id = a.job_id AND j.workshop_id = a.workshop_id
        JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
        JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
        WHERE a.workshop_id = ?${activityScope}
      ) AS recent_activity
      ORDER BY occurred_at DESC, id DESC
      LIMIT 12
    `, auth.workshop_id, ...activityScopeBindings,
      auth.workshop_id, ...activityScopeBindings);

    const registrations = auth.role === 'technician'
      ? []
      : await db.query(`
          SELECT id, record_type, customer_id, customer_name, customer_code,
            vehicle_id, vehicle_code, registration_number, make, model, created_at
          FROM (
            SELECT CONCAT('customer:', c.id) AS id, 'customer' AS record_type,
              c.id AS customer_id, c.display_name AS customer_name,
              c.customer_code, NULL AS vehicle_id, NULL AS vehicle_code,
              NULL AS registration_number, NULL AS make, NULL AS model,
              c.created_at
            FROM customers c
            WHERE c.workshop_id = ?
            UNION ALL
            SELECT CONCAT('vehicle:', v.id) AS id, 'vehicle' AS record_type,
              c.id AS customer_id, c.display_name AS customer_name,
              c.customer_code, v.id AS vehicle_id, v.vehicle_code,
              v.plate AS registration_number, v.make, v.model, v.created_at
            FROM vehicles v
            JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
            WHERE v.workshop_id = ?
          ) AS recent_registrations
          ORDER BY created_at DESC, id DESC
          LIMIT 12
        `, auth.workshop_id, auth.workshop_id);

    response.json({
      summary,
      jobs: activeRecords.map((record) => ({
        ...record,
        customer_phone: auth.role === 'technician' ? null : record.customer_phone,
        customer_email: auth.role === 'technician' ? null : record.customer_email,
      })),
      mechanics,
      bays,
      alerts,
      activities,
      registrations,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}));

async function resolveDiagnosisKnowledgeLinks(
  faultName: string,
  vehicleId: string,
  workshopId: string
): Promise<{ fault_record_id: string | null; catalogue_model_id: string | null }> {
  const vehicle = await db.first(`
    SELECT make, model, catalogue_model_id FROM vehicles WHERE id = ? AND workshop_id = ?
  `, vehicleId, workshopId) as { make: string; model: string; catalogue_model_id: string | null } | undefined;
  let catalogueModelId = vehicle?.catalogue_model_id ?? null;
  if (!catalogueModelId && vehicle) {
    const match = await db.first(`
      SELECT vm.id
      FROM vehicle_models vm
      JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
      WHERE LOWER(m.name) = LOWER(?) AND LOWER(vm.name) = LOWER(?)
      LIMIT 1
    `, vehicle.make, vehicle.model) as { id: string } | undefined;
    catalogueModelId = match?.id ?? null;
    if (!catalogueModelId) {
      const central = resolveCatalogueModel(vehicle.make, vehicle.model);
      if (central) catalogueModelId = central.id;
    }
  }
  const fault = await db.first(`
    SELECT id FROM vehicle_fault_records
    WHERE is_active = 1 AND LOWER(fault_name) = LOWER(?)
      AND (model_id IS NULL OR model_id = ? OR manufacturer_id IS NULL)
    ORDER BY CASE WHEN model_id = ? THEN 0 WHEN model_id IS NULL THEN 1 ELSE 2 END
    LIMIT 1
  `, faultName, catalogueModelId, catalogueModelId) as { id: string } | undefined;
  return { fault_record_id: fault?.id ?? null, catalogue_model_id: catalogueModelId };
}

app.post('/api/diagnoses/predict', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  const body = requireObject(request.body);
  const allowedFields = ['vehicle_id', 'symptoms', 'job_id', 'include_context'];
  if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
    throw new HttpError(400, 'The diagnosis request contains unsupported fields.');
  }
  const vehicleId = requiredText(body.vehicle_id, 'Vehicle', 1, 36);
  const symptoms = requiredText(body.symptoms, 'Symptoms', 10, 2000);
  const vehicle = await requireDiagnosisVehicleAccess(vehicleId, auth);
  const jobId = body.job_id === undefined || body.job_id === null || body.job_id === ''
    ? null
    : requiredText(body.job_id, 'Repair job', 1, 36);
  if (body.include_context !== undefined && typeof body.include_context !== 'boolean') {
    throw new HttpError(400, 'Include context must be true or false.');
  }
  if (jobId) {
    await requireRepairAccess(jobId, auth);
    const job = await db.first('SELECT vehicle_id FROM jobs WHERE id = ? AND workshop_id = ?', jobId, auth.workshop_id) as { vehicle_id: string } | undefined;
    if (!job || job.vehicle_id !== vehicleId) throw new HttpError(400, 'The selected repair job does not belong to this vehicle.');
  }
  const { context, classifierInput, modelContext } = await buildDiagnosisContext(vehicleId, symptoms, auth, body.include_context !== false);
  const result = await runDiagnosisPrediction(classifierInput, modelContext);
  const best = result.predictions[0];
  if (!best || !Number.isFinite(best.confidence) || best.confidence < 0 || best.confidence > 1) {
    throw new HttpError(503, 'The diagnosis model returned an invalid confidence score.');
  }
  const predictions = result.predictions.map((candidate) => ({
    ...candidate,
    affected_component: componentForFault(candidate.fault_category),
  }));
  const affectedComponent = componentForFault(best.fault_category);
  const knowledgeLinks = await resolveDiagnosisKnowledgeLinks(best.fault_category, vehicleId, auth.workshop_id);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute(`
    INSERT INTO ai_diagnoses (
      id, workshop_id, customer_id, vehicle_id, job_id, reported_symptoms,
      predicted_fault, confidence, prediction_candidates_json, affected_component,
      model_version, possible_causes_json, recommendations_json, input_context_json,
      fault_record_id, catalogue_model_id, created_by_user_id, created_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, auth.workshop_id, vehicle.customer_id, vehicleId, jobId, symptoms,
    best.fault_category, best.confidence, JSON.stringify(predictions), affectedComponent,
    result.model_version ?? null, JSON.stringify(best.possible_causes ?? []),
    JSON.stringify(best.inspection_procedures), JSON.stringify(context),
    knowledgeLinks.fault_record_id, knowledgeLinks.catalogue_model_id, auth.id,
    auth.name, createdAt);
  response.status(201).json({
    diagnosis: {
      id,
      vehicle_id: vehicleId,
      customer_id: vehicle.customer_id,
      job_id: jobId,
      reported_symptoms: symptoms,
      predicted_fault: best.fault_category,
      confidence: best.confidence,
      predictions,
      affected_component: affectedComponent,
      possible_causes: best.possible_causes ?? [],
      recommendations: best.inspection_procedures,
      review_status: 'pending',
      created_by_name: auth.name,
      created_at: createdAt,
      model: result.model,
      model_version: result.model_version ?? null,
      library_version: result.library_version ?? null,
      fault_record_id: knowledgeLinks.fault_record_id,
      catalogue_model_id: knowledgeLinks.catalogue_model_id,
      generated_at: result.generated_at ?? createdAt,
      context,
      context_used: result.context_used ?? null,
      warning: result.warning,
      data_limitations: result.data_limitations ?? null,
    },
  });
}));

app.get('/api/vehicles/:vehicleId/diagnoses', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const records = await db.query(`
      SELECT id, workshop_id, customer_id, vehicle_id, job_id, reported_symptoms,
        predicted_fault, confidence, prediction_candidates_json, affected_component,
        model_version, possible_causes_json, recommendations_json, input_context_json,
        fault_record_id, catalogue_model_id, review_status, confirmed_fault, mechanic_notes,
        created_by_name, created_at, reviewed_at
      FROM ai_diagnoses
      WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `, request.params.vehicleId, auth.workshop_id) as (Record<string, unknown> & {
      prediction_candidates_json: string;
      possible_causes_json: string | null;
      recommendations_json: string | null;
      input_context_json: string | null;
    })[];
    response.json({ records: records.map(({ prediction_candidates_json, possible_causes_json, recommendations_json, input_context_json, ...record }) => ({
      ...record,
      predictions: JSON.parse(prediction_candidates_json),
      possible_causes: possible_causes_json ? JSON.parse(possible_causes_json) : [],
      recommendations: recommendations_json ? JSON.parse(recommendations_json) : [],
      context: input_context_json ? JSON.parse(input_context_json) : null,
    })) });
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/diagnoses/:id/review', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const body = requireObject(request.body);
    const allowed = ['review_status', 'confirmed_fault', 'mechanic_notes', 'job_id'];
    if (Object.keys(body).some((field) => !allowed.includes(field))) {
      throw new HttpError(400, 'The diagnosis review contains unsupported fields.');
    }
    const reviewStatus = body.review_status;
    if (reviewStatus !== 'confirmed' && reviewStatus !== 'corrected' && reviewStatus !== 'dismissed') {
      throw new HttpError(400, 'Choose confirmed, corrected, or dismissed.');
    }
    const diagnosis = await db.first(`
      SELECT id, customer_id, vehicle_id, review_status, affected_component FROM ai_diagnoses
      WHERE id = ? AND workshop_id = ?
    `, request.params.id, auth.workshop_id) as { id: string; customer_id: string; vehicle_id: string; review_status: string; affected_component: string | null } | undefined;
    if (!diagnosis) throw new HttpError(404, 'Diagnosis not found.');
    if (diagnosis.review_status !== 'pending') throw new HttpError(409, 'This diagnosis has already been reviewed.');
    await requireDiagnosisVehicleAccess(diagnosis.vehicle_id, auth);
    const confirmedFault = reviewStatus === 'dismissed'
      ? null
      : requiredText(body.confirmed_fault, 'Mechanic-confirmed fault', 2, 160);
    const mechanicNotes = body.mechanic_notes === undefined
      ? null
      : optionalCustomerText(body.mechanic_notes, 'Mechanic notes', 4000);
    const jobId = body.job_id === undefined || body.job_id === null || body.job_id === ''
      ? null
      : requiredText(body.job_id, 'Repair job', 1, 36);
    if (jobId) {
      if (reviewStatus === 'dismissed') throw new HttpError(400, 'A dismissed diagnosis cannot be linked to a repair job.');
      await requireRepairAccess(jobId, auth);
      const job = await db.first('SELECT vehicle_id FROM jobs WHERE id = ? AND workshop_id = ?', jobId, auth.workshop_id) as { vehicle_id: string } | undefined;
      if (!job || job.vehicle_id !== diagnosis.vehicle_id) throw new HttpError(400, 'The selected repair job does not belong to this vehicle.');
    }
    const reviewedAt = new Date().toISOString();
    const reviewedComponent = reviewStatus === 'dismissed'
      ? diagnosis.affected_component
      : componentForFault(confirmedFault as string);
    await db.execute(`
      UPDATE ai_diagnoses SET review_status = ?, confirmed_fault = ?, mechanic_notes = ?,
        job_id = COALESCE(?, job_id), affected_component = ?, reviewed_at = ?
      WHERE id = ? AND workshop_id = ?
    `, reviewStatus, confirmedFault, mechanicNotes, jobId, reviewedComponent, reviewedAt, diagnosis.id, auth.workshop_id);
    response.json({ id: diagnosis.id, review_status: reviewStatus, confirmed_fault: confirmedFault, affected_component: reviewedComponent, job_id: jobId, reviewed_at: reviewedAt });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/smart-workshop/config', requireAuth, (_request, response) => {
  response.json({
    config: SMART_WORKSHOP_CONFIG,
    conditions: INSPECTION_CONDITIONS,
  });
});

app.get('/api/smart-workshop/vehicles/:vehicleId', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const vehicle = await db.first(`
      SELECT v.id, v.customer_id, v.vehicle_code, v.plate AS registration_number, v.make, v.model,
        v.model_year, v.mileage, v.vin, v.engine_number, c.display_name AS customer_name,
        v.catalogue_model_id, v.engine_type, v.engine_capacity_cc, v.fuel_type,
        v.transmission_type, v.drive_type
      FROM vehicles v LEFT JOIN customers c
        ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      WHERE v.id = ? AND v.workshop_id = ?
    `, request.params.vehicleId, auth.workshop_id) as Record<string, unknown> | undefined;
    if (!vehicle) throw new HttpError(404, 'Vehicle not found.');

    // Catalogue linkage is looked up, never silently invented. An unlinked
    // vehicle keeps its registered make/model and reports missing specifications.
    let catalogueModel = vehicle.catalogue_model_id
      ? await db.first(`
          SELECT vm.id, vm.name, vm.body_style, vm.asset_key, vm.asset_status, vm.specification_note,
            m.name AS manufacturer_name
          FROM vehicle_models vm JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
          WHERE vm.id = ?
        `, String(vehicle.catalogue_model_id))
      : undefined;
    if (!catalogueModel) {
      catalogueModel = await db.first(`
        SELECT vm.id, vm.name, vm.body_style, vm.asset_key, vm.asset_status, vm.specification_note,
          m.name AS manufacturer_name
        FROM vehicle_models vm JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
        WHERE LOWER(m.name) = LOWER(?) AND LOWER(vm.name) = LOWER(?)
        LIMIT 1
      `, String(vehicle.make), String(vehicle.model));
    }
    if (!catalogueModel) {
      const central = resolveCatalogueModel(String(vehicle.make), String(vehicle.model));
      if (central) {
        catalogueModel = await db.first(`
          SELECT vm.id, vm.name, vm.body_style, vm.asset_key, vm.asset_status, vm.specification_note,
            m.name AS manufacturer_name
          FROM vehicle_models vm JOIN vehicle_manufacturers m ON m.id = vm.manufacturer_id
          WHERE vm.id = ?
        `, central.id);
      }
    }
    const modelAsset = catalogueModel?.asset_key
      ? await db.first('SELECT * FROM vehicle_3d_assets WHERE asset_key = ?', String(catalogueModel.asset_key))
      : undefined;
    const assetDescriptor = modelAsset ? describeAsset(modelAsset as Record<string, unknown>) : null;
    const catalogueSpecification = catalogueModel
      ? await db.first(`
          SELECT engine_type, engine_capacity_cc, fuel_type, transmission_type, drive_type,
            data_source, verification_status
          FROM vehicle_specifications
          WHERE model_id = ? AND verification_status != 'not_recorded'
          ORDER BY id DESC LIMIT 1
        `, String(catalogueModel.id))
      : undefined;
    const specificationFields: { label: string; value: unknown }[] = [
      { label: 'Engine type', value: vehicle.engine_type ?? catalogueSpecification?.engine_type },
      { label: 'Engine capacity', value: vehicle.engine_capacity_cc ?? catalogueSpecification?.engine_capacity_cc },
      { label: 'Fuel type', value: vehicle.fuel_type ?? catalogueSpecification?.fuel_type },
      { label: 'Transmission', value: vehicle.transmission_type ?? catalogueSpecification?.transmission_type },
      { label: 'Drive type', value: vehicle.drive_type ?? catalogueSpecification?.drive_type },
    ];
    const missingSpecifications = specificationFields
      .filter((field) => field.value === null || field.value === undefined || field.value === '')
      .map((field) => field.label);

    const inspectionRows = await db.query(`
      SELECT id, component_name, condition_status, inspection_notes, inspection_date,
        inspected_by_name, job_id, created_at
      FROM vehicle_component_inspections
      WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY inspection_date DESC LIMIT 100
    `, request.params.vehicleId, auth.workshop_id) as Record<string, unknown>[];
    const inspections: SmartWorkshopInspection[] = inspectionRows.map((row) => ({
      component_name: String(row.component_name),
      condition: typeof row.condition_status === 'string' ? row.condition_status : undefined,
      inspection_date: String(row.inspection_date),
      inspection_notes: typeof row.inspection_notes === 'string' ? row.inspection_notes : null,
      inspected_by_name: typeof row.inspected_by_name === 'string' ? row.inspected_by_name : null,
    }));

    const diagnosisRows = await db.query(`
      SELECT id, vehicle_id, job_id, reported_symptoms, predicted_fault, confidence,
        prediction_candidates_json, possible_causes_json, recommendations_json,
        affected_component, model_version, review_status, confirmed_fault,
        mechanic_notes, created_at, reviewed_at
      FROM ai_diagnoses
      WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY created_at DESC LIMIT 25
    `, request.params.vehicleId, auth.workshop_id) as (Record<string, unknown> & {
      prediction_candidates_json: string;
      possible_causes_json: string | null;
      recommendations_json: string | null;
    })[];
    const predictions = diagnosisPredictionRows(diagnosisRows).map((row, index) => {
      const raw = diagnosisRows[index];
      return {
        ...row,
        predictions: JSON.parse(raw.prediction_candidates_json),
        possible_causes: raw.possible_causes_json ? JSON.parse(raw.possible_causes_json) : [],
        recommendations: raw.recommendations_json ? JSON.parse(raw.recommendations_json) : [],
      };
    });
    const repairs = await db.query(`
      SELECT id, job_no AS repair_job_code, service_type, repair_status, issue_description,
        assigned_technician, created_at
      FROM jobs WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY created_at DESC LIMIT 10
    `, request.params.vehicleId, auth.workshop_id);
    // The mechanic responsible for this vehicle comes from the existing repair assignment.
    const activeAssignment = await db.first(`
      SELECT j.id AS job_id, j.job_no AS repair_job_code, j.repair_status, j.service_type,
        u.id AS user_id, u.name AS user_name,
        m.id AS mechanic_id, m.mechanic_number, m.full_name AS mechanic_name, m.specialization
      FROM jobs j
      LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
      WHERE j.vehicle_id = ? AND j.workshop_id = ? AND j.assigned_technician IS NOT NULL
      ORDER BY j.created_at DESC LIMIT 1
    `, request.params.vehicleId, auth.workshop_id);
    response.json({
      vehicle,
      config: SMART_WORKSHOP_CONFIG,
      conditions: INSPECTION_CONDITIONS,
      statuses: deriveComponentStatuses(COMPONENT_KEYS, inspections, predictions),
      inspections: inspectionRows,
      diagnoses: predictions,
      repairs,
      active_assignment: activeAssignment ?? null,
      catalogue_model: catalogueModel ?? null,
      model_asset: assetDescriptor
        ? { ...assetDescriptor, node_map_json: JSON.stringify(assetDescriptor.node_map) }
        : null,
      asset_status: assetDescriptor?.availability_status ?? 'missing',
      available_view_modes: assetDescriptor?.available_view_modes ?? [],
      specifications: {
        fields: specificationFields,
        missing: missingSpecifications,
        note: 'Missing specifications are not inferred. Add verified details from the vehicle service book or manufacturer data.',
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/vehicles/:vehicleId/component-inspections', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const records = await db.query(`
      SELECT id, vehicle_id, job_id, component_name, condition_status, inspection_notes,
        inspection_date, inspected_by_name, created_at
      FROM vehicle_component_inspections
      WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY inspection_date DESC LIMIT 100
    `, request.params.vehicleId, auth.workshop_id);
    response.json({ records });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/vehicles/:vehicleId/component-inspections', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const body = requireObject(request.body);
    const allowed = ['component_name', 'condition_status', 'inspection_notes', 'inspection_date', 'job_id'];
    if (Object.keys(body).some((field) => !allowed.includes(field))) {
      throw new HttpError(400, 'The inspection record contains unsupported fields.');
    }
    const componentName = requiredText(body.component_name, 'Component', 1, 64);
    if (!isComponentKey(componentName)) throw new HttpError(400, 'Select a supported component.');
    const validConditions = INSPECTION_CONDITIONS.map((entry) => entry.value);
    if (typeof body.condition_status !== 'string' || !validConditions.includes(body.condition_status as typeof validConditions[number])) {
      throw new HttpError(400, 'Select a supported inspection condition.');
    }
    const inspectionNotes = optionalCustomerText(body.inspection_notes, 'Inspection notes', 4000);
    const inspectionDate = body.inspection_date === undefined || body.inspection_date === null || body.inspection_date === ''
      ? new Date().toISOString()
      : validDate(body.inspection_date, 'Inspection date');
    const jobId = body.job_id === undefined || body.job_id === null || body.job_id === ''
      ? null
      : requiredText(body.job_id, 'Repair job', 1, 36);
    if (jobId) {
      await requireRepairAccess(jobId, auth);
      const job = await db.first('SELECT vehicle_id FROM jobs WHERE id = ? AND workshop_id = ?', jobId, auth.workshop_id) as { vehicle_id: string } | undefined;
      if (!job || job.vehicle_id !== request.params.vehicleId) throw new HttpError(400, 'The selected repair job does not belong to this vehicle.');
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await db.execute(`
      INSERT INTO vehicle_component_inspections (
        id, workshop_id, vehicle_id, job_id, component_name, condition_status,
        inspection_notes, inspected_by_user_id, inspected_by_name, inspection_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, auth.workshop_id, request.params.vehicleId, jobId, componentName,
      body.condition_status, inspectionNotes, auth.id, auth.name, inspectionDate, createdAt);
    response.status(201).json({
      record: {
        id, vehicle_id: request.params.vehicleId, job_id: jobId, component_name: componentName,
        condition_status: body.condition_status, inspection_notes: inspectionNotes,
        inspected_by_name: auth.name, inspection_date: inspectionDate, created_at: createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/repairs/mechanics', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  requireRepairStaff(auth);
  const mechanics = await db.query(`
    SELECT id, name FROM users
    WHERE workshop_id = ? AND role = 'technician'
    ORDER BY name ASC
  `, auth.workshop_id);
  response.json({ records: mechanics });
}));

app.get('/api/repairs/search', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const { where, bindings } = repairFilters(request, auth);
    const records = await db.query(`
      ${repairSelect}
      WHERE ${where}
      ORDER BY j.created_at DESC
      LIMIT 50
    `, ...bindings);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/repairs', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const limit = request.query.limit === undefined ? 25 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 100 and a non-negative offset.');
    }
    const { where, bindings } = repairFilters(request, auth);
    const sort = repairSortField(request.query.sort);
    const order = typeof request.query.order === 'string' ? request.query.order.toLowerCase() : 'desc';
    if (!['asc', 'desc'].includes(order)) throw new HttpError(400, 'Sort order must be asc or desc.');
    const total = (await db.first(`
      SELECT COUNT(*) AS total
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      JOIN customers c ON c.id = v.customer_id AND c.workshop_id = v.workshop_id
      LEFT JOIN users u ON u.id = (
        SELECT assigned.id FROM users assigned
        WHERE assigned.workshop_id = j.workshop_id
          AND (assigned.id = j.assigned_technician OR assigned.name = j.assigned_technician)
        LIMIT 1
      )
      WHERE ${where}
    `, ...bindings) as { total: number }).total;
    const records = await db.query(`
      ${repairSelect}
      WHERE ${where}
      ORDER BY ${sort} ${order.toUpperCase()}, j.created_at DESC
      LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({
      records,
      total,
      limit,
      offset,
      summary: await repairSummary(auth.workshop_id, auth.role === 'technician' ? auth : undefined),
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/repairs', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireRepairStaff(auth);
    const body = requireObject(request.body);
    const values = validateRepairFields(body, true);
    const customerId = values.customerId;
    const vehicleId = values.vehicleId;
    const serviceType = values.serviceType;
    const reportedProblem = values.problem;
    if (!customerId || !vehicleId || !serviceType || !reportedProblem) {
      throw new HttpError(400, 'Customer, vehicle, service type, and reported problem are required.');
    }
    const vehicle = await db.first(`
      SELECT v.id FROM vehicles v
      WHERE v.id = ? AND v.customer_id = ? AND v.workshop_id = ?
    `, vehicleId, customerId, auth.workshop_id);
    if (!vehicle) {
      throw new HttpError(400, 'The selected vehicle must belong to the selected customer in this workshop.');
    }
    if (values.diagnosisId) {
      const diagnosis = await db.first(`
        SELECT id FROM ai_diagnoses
        WHERE id = ? AND workshop_id = ? AND customer_id = ? AND vehicle_id = ?
          AND review_status IN ('confirmed', 'corrected') AND job_id IS NULL
      `, values.diagnosisId, auth.workshop_id, customerId, vehicleId);
      if (!diagnosis) {
        throw new HttpError(400, 'Only an unlinked, mechanic-confirmed diagnosis for this customer and vehicle can create a repair job.');
      }
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const jobCode = `JOB-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    const trackingNumber = `NG-${new Date().getFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
    const initialStatus = 'Received';
    const priority = values.priority ?? 'Normal';
    const labourCost = values.labourCost ?? 0;
    const partsCost = values.partsCost ?? 0;
    const totalCost = labourCost + partsCost;
    const promisedAt = values.expectedDate ?? null;
    validateRepairDates(now.slice(0, 10), promisedAt);

    await db.transaction(async () => {
      await db.execute(`
        INSERT INTO jobs (
          id, workshop_id, vehicle_id, job_no, service_type, issue_description,
          status, priority, assigned_technician, estimated_amount_cents,
          promised_at, notes, created_at, updated_at, tracking_number, bay,
          repair_status, repair_priority, inspection_notes,
          estimated_labour_cost_cents, estimated_parts_cost_cents,
          estimated_total_cost_cents, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, auth.workshop_id, vehicleId, jobCode, serviceType,
        reportedProblem, legacyRepairStatus(initialStatus), legacyRepairPriority(priority),
        null, totalCost, promisedAt, values.notes ?? null, now, now, trackingNumber, values.bay ?? null,
        initialStatus, priority, values.inspectionNotes ?? null, labourCost, partsCost,
        totalCost, auth.id);
      await insertRepairStatusHistory(
        id, auth.workshop_id, null, initialStatus, values.statusNote ?? null, auth, now
      );
      if (values.mechanicId) await assignRepairMechanic(id, auth.workshop_id, values.mechanicId, auth, now);
      if (values.diagnosisId) {
        const linked = await db.execute(`
          UPDATE ai_diagnoses SET job_id = ?
          WHERE id = ? AND workshop_id = ? AND customer_id = ? AND vehicle_id = ?
            AND review_status IN ('confirmed', 'corrected') AND job_id IS NULL
        `, id, values.diagnosisId, auth.workshop_id, customerId, vehicleId);
        if (Number(linked.affectedRows) !== 1) throw new HttpError(409, 'This diagnosis was already linked to a repair job.');
      }

  });

    response.status(201).json({ record: await repairJob(id, auth.workshop_id) });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customers/:id/repairs', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (auth.role !== 'technician') requireRepairStaff(auth);
    const customer = await db.first('SELECT id FROM customers WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    if (!customer) throw new HttpError(404, 'Customer not found.');
    const technicianClause = auth.role === 'technician'
      ? ' AND j.assigned_technician IN (?, ?)'
      : '';
    const args = auth.role === 'technician'
      ? [request.params.id, auth.workshop_id, auth.name, auth.id]
      : [request.params.id, auth.workshop_id];
    const records = await db.query(`
      ${repairSelect}
      WHERE c.id = ? AND j.workshop_id = ?${technicianClause}
      ORDER BY j.created_at DESC
    `, ...args);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/vehicles/:id/repairs', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (auth.role !== 'technician') requireRepairStaff(auth);
    const vehicle = await db.first('SELECT id FROM vehicles WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
    const technicianClause = auth.role === 'technician'
      ? ' AND j.assigned_technician IN (?, ?)'
      : '';
    const args = auth.role === 'technician'
      ? [request.params.id, auth.workshop_id, auth.name, auth.id]
      : [request.params.id, auth.workshop_id];
    const records = await db.query(`
      ${repairSelect}
      WHERE v.id = ? AND j.workshop_id = ?${technicianClause}
      ORDER BY j.created_at DESC
    `, ...args);
    response.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/repairs/:id/history', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireRepairAccess(request.params.id, auth);
    const statusHistory = await db.query(`
      SELECT id, previous_status, new_status, note, changed_by_user_id,
        changed_by_name, changed_at
      FROM repair_status_history
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY changed_at ASC, id ASC
    `, request.params.id, auth.workshop_id);
    const activities = await db.query(`
      SELECT id, work_performed, inspection_findings, problems_identified,
        recommendations, additional_work_required, internal_notes,
        created_by_user_id, created_by_name, created_at
      FROM repair_activity_logs
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY created_at ASC, id ASC
    `, request.params.id, auth.workshop_id);
    const assignments = await db.query(`
      SELECT id, mechanic_user_id, mechanic_name, assigned_by_user_id,
        assigned_by_name, assigned_at, unassigned_at
      FROM repair_mechanic_assignments
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY assigned_at ASC, id ASC
    `, request.params.id, auth.workshop_id);
    response.json({ statusHistory, activities, assignments });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/repairs/:id/activities', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireRepairAccess(request.params.id, auth);
    const body = requireObject(request.body);
    const allowed = [
      'work_performed', 'inspection_findings', 'problems_identified',
      'recommendations', 'additional_work_required', 'internal_notes',
    ];
    if (Object.keys(body).some((field) => !allowed.includes(field))) {
      throw new HttpError(400, 'The activity contains unsupported fields.');
    }
    const fields = Object.fromEntries(allowed.map((field) => [
      field,
      optionalCustomerText(body[field], field.replaceAll('_', ' '), 4000),
    ])) as Record<string, string | null>;
    if (Object.values(fields).every((value) => value === null)) {
      throw new HttpError(400, 'Enter at least one repair activity detail.');
    }
    const record = await insertRepairActivity({
      workshopId: auth.workshop_id,
      jobId: request.params.id,
      fields,
      auth,
      createdAt: new Date().toISOString(),
    });
    response.status(201).json({ record });
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/repairs/:id/assignment', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireRepairStaff(auth);
    const body = requireObject(request.body);
    if (Object.keys(body).some((field) => field !== 'mechanic_id')) {
      throw new HttpError(400, 'Only mechanic_id can be changed through this endpoint.');
    }
    const mechanicId = body.mechanic_id === null || body.mechanic_id === ''
      ? null
      : requiredText(body.mechanic_id, 'Mechanic', 1, 36);
    const existing = await repairJob(request.params.id, auth.workshop_id);
    if (!existing) throw new HttpError(404, 'Repair job not found.');
    const now = new Date().toISOString();

    await db.transaction(async () => {
      await assignRepairMechanic(request.params.id, auth.workshop_id, mechanicId, auth, now);

  });

    response.json({ record: await repairJob(request.params.id, auth.workshop_id) });
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/repairs/:id/status', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const existing = await requireRepairAccess(request.params.id, auth);
    const body = requireObject(request.body);
    if (Object.keys(body).some((field) => !['status', 'note'].includes(field))) {
      throw new HttpError(400, 'Only status and update note can be changed here.');
    }
    const nextStatus = body.status;
    if (!isRepairStatus(nextStatus)) throw new HttpError(400, 'Repair status is invalid.');
    const note = body.note === undefined ? null : optionalCustomerText(body.note, 'Update note', 2000);
    const now = new Date().toISOString();

    await db.transaction(async () => {
      await changeRepairStatus(existing, nextStatus, note, auth, now);
    });

    response.json({ record: await repairJob(request.params.id, auth.workshop_id, auth.role === 'technician' ? auth : undefined) });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/repairs/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const record = await requireRepairAccess(request.params.id, auth);
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

app.put('/api/repairs/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireRepairStaff(auth);
    const id = request.params.id;
    const existing = await repairJob(id, auth.workshop_id);
    if (!existing) throw new HttpError(404, 'Repair job not found.');
    const body = requireObject(request.body);
    if (Object.keys(body).length === 0) throw new HttpError(400, 'Provide at least one repair field to update.');
    const values = validateRepairFields(body, false);
    const expectedDate = values.expectedDate === undefined ? existing.promised_at : values.expectedDate;
    validateRepairDates(existing.created_at.slice(0, 10), expectedDate);
    const labourCost = values.labourCost ?? existing.estimated_labour_cost_cents;
    const partsCost = values.partsCost ?? existing.estimated_parts_cost_cents;
    const totalCost = labourCost + partsCost;
    if (!Number.isSafeInteger(totalCost) || totalCost > 200_000_000) {
      throw new HttpError(400, 'Estimated total cost is above the supported maximum.');
    }
    const serviceType = values.serviceType ?? existing.service_type;
    const problem = values.problem ?? existing.issue_description;
    const priority = values.priority ?? existing.repair_priority;
    const mappedLegacyPriority = legacyRepairPriority(priority);
    const now = new Date().toISOString();

    await db.transaction(async () => {
      await db.execute(`
        UPDATE jobs
        SET service_type = ?, issue_description = ?, inspection_notes = ?, bay = ?,
          repair_priority = ?, priority = ?, promised_at = ?, notes = ?,
          estimated_labour_cost_cents = ?, estimated_parts_cost_cents = ?,
          estimated_total_cost_cents = ?, estimated_amount_cents = ?, updated_at = ?
        WHERE id = ? AND workshop_id = ?
      `, serviceType, problem, values.inspectionNotes === undefined ? existing.inspection_notes : values.inspectionNotes,
        values.bay === undefined ? existing.bay : values.bay,
        priority, mappedLegacyPriority, expectedDate, values.notes === undefined ? existing.notes : values.notes,
        labourCost, partsCost, totalCost, totalCost, now, id, auth.workshop_id);
      if (values.mechanicId !== undefined && values.mechanicId !== existing.assigned_technician) {
        await assignRepairMechanic(id, auth.workshop_id, values.mechanicId, auth, now);
      }

  });

    response.json({ record: await repairJob(id, auth.workshop_id) });
  } catch (error) {
    next(error);
  }
}));

function requireInventoryManager(auth: AuthContext): void {
  if (!isStaffRole(auth.role)) throw new HttpError(403, 'role_forbidden');
}

function inventoryText(value: unknown, label: string, maxLength: number, nullable = false): string | null {
  if ((value === undefined || value === null || value === '') && nullable) return null;
  return requiredText(value, label, 1, maxLength);
}

function inventoryInteger(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 1_000_000) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to 1,000,000.`);
  }
  return value;
}

function inventoryCents(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new HttpError(400, `${label} must be a non-negative amount in cents.`);
  }
  return value;
}

function inventoryDate(value: unknown): string {
  if (value === undefined || value === null || value === '') return new Date().toISOString();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'Transaction date must be a valid date.');
  }
  return new Date(value).toISOString();
}

async function insertStockTransaction(input: {
  workshopId: string;
  partId: string;
  jobId?: string | null;
  vehicleId?: string | null;
  type: 'purchase' | 'repair_issue' | 'damage' | 'return' | 'adjustment';
  delta: number;
  unitCostCents: number;
  note: string | null;
  auth: AuthContext;
  transactionAt: string;
}): Promise<string> {
  const id = randomUUID();
  await db.execute(`
    INSERT INTO stock_transactions (
      id, workshop_id, part_id, job_id, vehicle_id, transaction_type,
      quantity_delta, unit_cost_cents, note, responsible_user_id,
      responsible_name, transaction_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, input.workshopId, input.partId, input.jobId ?? null, input.vehicleId ?? null,
    input.type, input.delta, input.unitCostCents, input.note, input.auth.id,
    input.auth.name, input.transactionAt, new Date().toISOString());
  return id;
}

app.get('/api/inventory/dashboard', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  const summary = await db.first(`
    SELECT COUNT(*) AS total_parts,
      COALESCE(SUM(quantity), 0) AS total_stock,
      SUM(CASE WHEN quantity > 0 AND quantity <= reorder_level THEN 1 ELSE 0 END) AS low_stock_items,
      SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock_items
    FROM parts WHERE workshop_id = ?
  `, auth.workshop_id) as {
    total_parts: number; total_stock: number; low_stock_items: number; out_of_stock_items: number;
  };
  const used = await db.first(`
    SELECT COALESCE(SUM(-quantity_delta), 0) AS quantity
    FROM stock_transactions WHERE workshop_id = ? AND transaction_type = 'repair_issue'
  `, auth.workshop_id) as { quantity: number };
  const recent = await db.query(`
    SELECT t.id, t.transaction_type, t.quantity_delta, t.transaction_at,
      t.responsible_name, p.name AS part_name, p.sku AS part_number,
      j.job_no AS repair_job_code, v.plate AS registration_number
    FROM stock_transactions t
    JOIN parts p ON p.id = t.part_id AND p.workshop_id = t.workshop_id
    LEFT JOIN jobs j ON j.id = t.job_id AND j.workshop_id = t.workshop_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id AND v.workshop_id = t.workshop_id
    WHERE t.workshop_id = ? ORDER BY t.transaction_at DESC, t.created_at DESC LIMIT 8
  `, auth.workshop_id);
  response.json({ summary: { ...summary, parts_used: used.quantity }, recent });
}));

app.get('/api/parts', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 200 and a non-negative offset.');
    }
    const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const category = typeof request.query.category === 'string' ? request.query.category.trim() : '';
    const stock = typeof request.query.stock === 'string' ? request.query.stock : '';
    const where = ['p.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ? OR s.name LIKE ?)');
      const like = `%${q}%`;
      bindings.push(like, like, like, like);
    }
    if (category) { where.push('p.category = ?'); bindings.push(category); }
    if (stock === 'low') where.push('p.quantity > 0 AND p.quantity <= p.reorder_level');
    else if (stock === 'out') where.push('p.quantity = 0');
    else if (stock === 'available') where.push('p.quantity > p.reorder_level');
    else if (stock) throw new HttpError(400, 'Stock filter is invalid.');
    const clause = where.join(' AND ');
    const total = (await db.first(`SELECT COUNT(*) AS total FROM parts p LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.workshop_id = p.workshop_id WHERE ${clause}`, ...bindings) as { total: number }).total;
    const records = await db.query(`
      SELECT p.id, p.sku AS part_number, p.name, p.category, p.description,
        p.quantity, p.reorder_level AS minimum_stock, p.unit_cost_cents AS purchase_price_cents,
        p.selling_price_cents, p.supplier AS supplier_name_legacy, p.supplier_id,
        s.name AS supplier_name, p.created_at, p.updated_at
      FROM parts p LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.workshop_id = p.workshop_id
      WHERE ${clause} ORDER BY p.name ASC LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    const categories = await db.query(`SELECT DISTINCT category FROM parts WHERE workshop_id = ? ORDER BY category`, auth.workshop_id);
    response.json({ records, total, categories: categories.map((item) => (item as { category: string }).category) });
  } catch (error) { next(error); }
}));

app.post('/api/parts', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const body = requireObject(request.body);
    const partNumber = requiredText(body.part_number, 'Part number', 1, 80);
    const name = requiredText(body.name, 'Part name', 1, 160);
    const category = requiredText(body.category ?? 'General', 'Category', 1, 80);
    const description = inventoryText(body.description, 'Description', 2000, true);
    const purchasePrice = inventoryCents(body.purchase_price_cents ?? 0, 'Purchase price');
    const sellingPrice = inventoryCents(body.selling_price_cents ?? 0, 'Selling price');
    const minimumStock = inventoryInteger(body.minimum_stock ?? 0, 'Minimum stock');
    const initialStock = inventoryInteger(body.initial_stock ?? 0, 'Initial stock');
    const supplierId = inventoryText(body.supplier_id, 'Supplier', 36, true);
    const now = new Date().toISOString();
    const id = randomUUID();

    await db.transaction(async () => {
      if (await db.first('SELECT 1 FROM parts WHERE workshop_id = ? AND sku = ?', auth.workshop_id, partNumber)) {
        throw new HttpError(409, 'A part with this part number already exists.');
      }
      if (supplierId && !await db.first('SELECT 1 FROM suppliers WHERE id = ? AND workshop_id = ?', supplierId, auth.workshop_id)) {
        throw new HttpError(400, 'Select a supplier in this workshop.');
      }
      await db.execute(`
        INSERT INTO parts (id, workshop_id, sku, name, category, description, quantity,
          reorder_level, unit_cost_cents, selling_price_cents, supplier, supplier_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, auth.workshop_id, partNumber, name, category, description, initialStock,
        minimumStock, purchasePrice, sellingPrice, null, supplierId, now, now);
      if (initialStock > 0) await insertStockTransaction({
        workshopId: auth.workshop_id, partId: id, type: 'purchase', delta: initialStock,
        unitCostCents: purchasePrice, note: 'Opening stock', auth, transactionAt: now,
      });

  });

    response.status(201).json({ record: await db.first('SELECT * FROM parts WHERE id = ? AND workshop_id = ?', id, auth.workshop_id) });
  } catch (error) { next(error); }
}));

app.put('/api/parts/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const body = requireObject(request.body);
    const current = await db.first('SELECT * FROM parts WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id) as {
      id: string; sku: string; name: string; category: string; description: string | null;
      reorder_level: number; unit_cost_cents: number; selling_price_cents: number; supplier_id: string | null;
    } | undefined;
    if (!current) throw new HttpError(404, 'Part not found.');
    const partNumber = body.part_number === undefined ? current.sku : requiredText(body.part_number, 'Part number', 1, 80);
    const name = body.name === undefined ? current.name : requiredText(body.name, 'Part name', 1, 160);
    const category = body.category === undefined ? current.category : requiredText(body.category, 'Category', 1, 80);
    const description = body.description === undefined ? current.description : inventoryText(body.description, 'Description', 2000, true);
    const purchasePrice = body.purchase_price_cents === undefined ? current.unit_cost_cents : inventoryCents(body.purchase_price_cents, 'Purchase price');
    const sellingPrice = body.selling_price_cents === undefined ? current.selling_price_cents : inventoryCents(body.selling_price_cents, 'Selling price');
    const minimumStock = body.minimum_stock === undefined ? current.reorder_level : inventoryInteger(body.minimum_stock, 'Minimum stock');
    const supplierId = body.supplier_id === undefined ? current.supplier_id : inventoryText(body.supplier_id, 'Supplier', 36, true);
    if (await db.first('SELECT 1 FROM parts WHERE workshop_id = ? AND sku = ? AND id != ?', auth.workshop_id, partNumber, current.id)) {
      throw new HttpError(409, 'A part with this part number already exists.');
    }
    if (supplierId && !await db.first('SELECT 1 FROM suppliers WHERE id = ? AND workshop_id = ?', supplierId, auth.workshop_id)) {
      throw new HttpError(400, 'Select a supplier in this workshop.');
    }
    await db.execute(`UPDATE parts SET sku = ?, name = ?, category = ?, description = ?, unit_cost_cents = ?,
      selling_price_cents = ?, reorder_level = ?, supplier_id = ?, updated_at = ? WHERE id = ? AND workshop_id = ?`, partNumber, name, category, description, purchasePrice, sellingPrice, minimumStock,
        supplierId, new Date().toISOString(), current.id, auth.workshop_id);
    response.json({ record: await db.first('SELECT * FROM parts WHERE id = ? AND workshop_id = ?', current.id, auth.workshop_id) });
  } catch (error) { next(error); }
}));

app.delete('/api/parts/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const part = await db.first('SELECT quantity FROM parts WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id) as { quantity: number } | undefined;
    if (!part) throw new HttpError(404, 'Part not found.');
    if (part.quantity !== 0) throw new HttpError(409, 'Only parts with zero stock can be deleted.');
    try {
      await db.execute('DELETE FROM parts WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_ROW_IS_REFERENCED_2') {
        throw new HttpError(409, 'This part has stock or repair history and cannot be deleted.');
      }
      throw error;
    }
    response.status(204).end();
  } catch (error) { next(error); }
}));

app.get('/api/suppliers', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  const records = await db.query(`SELECT id, name, phone, email, address, created_at, updated_at
    FROM suppliers WHERE workshop_id = ? ORDER BY name`, auth.workshop_id);
  response.json({ records });
}));

app.post('/api/suppliers', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const body = requireObject(request.body);
    const name = requiredText(body.name, 'Supplier name', 1, 160);
    const phone = inventoryText(body.phone, 'Phone number', 40, true);
    const email = body.email === undefined || body.email === null || body.email === '' ? null : normalizedEmail(body.email);
    const address = inventoryText(body.address, 'Address', 500, true);
    if (await db.first('SELECT 1 FROM suppliers WHERE workshop_id = ? AND name = ?', auth.workshop_id, name)) {
      throw new HttpError(409, 'A supplier with this name already exists.');
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    await db.execute('INSERT INTO suppliers (id, workshop_id, name, phone, email, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, auth.workshop_id, name, phone, email, address, now, now);
    response.status(201).json({ record: await db.first('SELECT * FROM suppliers WHERE id = ? AND workshop_id = ?', id, auth.workshop_id) });
  } catch (error) { next(error); }
}));

app.put('/api/suppliers/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const body = requireObject(request.body);
    const current = await db.first('SELECT * FROM suppliers WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id) as {
      id: string; name: string; phone: string | null; email: string | null; address: string | null;
    } | undefined;
    if (!current) throw new HttpError(404, 'Supplier not found.');
    const name = body.name === undefined ? current.name : requiredText(body.name, 'Supplier name', 1, 160);
    const phone = body.phone === undefined ? current.phone : inventoryText(body.phone, 'Phone number', 40, true);
    const email = body.email === undefined ? current.email : (body.email === null || body.email === '' ? null : normalizedEmail(body.email));
    const address = body.address === undefined ? current.address : inventoryText(body.address, 'Address', 500, true);
    if (await db.first('SELECT 1 FROM suppliers WHERE workshop_id = ? AND name = ? AND id != ?', auth.workshop_id, name, current.id)) {
      throw new HttpError(409, 'A supplier with this name already exists.');
    }
    await db.execute('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, updated_at = ? WHERE id = ? AND workshop_id = ?', name, phone, email, address, new Date().toISOString(), current.id, auth.workshop_id);
    response.json({ record: await db.first('SELECT * FROM suppliers WHERE id = ? AND workshop_id = ?', current.id, auth.workshop_id) });
  } catch (error) { next(error); }
}));

app.delete('/api/suppliers/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const result = await db.execute('DELETE FROM suppliers WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'Supplier not found.');
    response.status(204).end();
  } catch (error) { next(error); }
}));

app.get('/api/inventory/transactions', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
    const offset = request.query.offset === undefined ? 0 : Number(request.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 200 and a non-negative offset.');
    }
    const type = typeof request.query.type === 'string' ? request.query.type : '';
    const where = ['t.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (type) {
      if (!['purchase', 'repair_issue', 'damage', 'return', 'adjustment'].includes(type)) throw new HttpError(400, 'Transaction type is invalid.');
      where.push('t.transaction_type = ?'); bindings.push(type);
    }
    const records = await db.query(`SELECT t.id, t.transaction_type, t.quantity_delta, t.unit_cost_cents,
      t.note, t.transaction_at, t.responsible_name, p.name AS part_name, p.sku AS part_number,
      j.job_no AS repair_job_code, v.plate AS registration_number
      FROM stock_transactions t JOIN parts p ON p.id = t.part_id AND p.workshop_id = t.workshop_id
      LEFT JOIN jobs j ON j.id = t.job_id AND j.workshop_id = t.workshop_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id AND v.workshop_id = t.workshop_id
      WHERE ${where.join(' AND ')} ORDER BY t.transaction_at DESC, t.created_at DESC LIMIT ? OFFSET ?`, ...bindings, limit, offset);
    const total = (await db.first(`SELECT COUNT(*) AS total FROM stock_transactions t WHERE ${where.join(' AND ')}`, ...bindings) as { total: number }).total;
    response.json({ records, total });
  } catch (error) { next(error); }
}));

app.post('/api/inventory/transactions', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireInventoryManager(auth);
    const body = requireObject(request.body);
    const partId = requiredText(body.part_id, 'Part', 1, 36);
    const type = body.transaction_type;
    if (type !== 'purchase' && type !== 'damage' && type !== 'return' && type !== 'adjustment') {
      throw new HttpError(400, 'Transaction type must be purchase, damage, return, or adjustment.');
    }
    const quantity = inventoryInteger(body.quantity, 'Quantity', type === 'adjustment' ? -1_000_000 : 1);
    if (type === 'adjustment' && quantity === 0) throw new HttpError(400, 'Adjustment quantity cannot be zero.');
    const delta = type === 'damage' ? -quantity : quantity;
    const jobId = inventoryText(body.job_id, 'Repair job', 36, true);
    const note = inventoryText(body.note, 'Note', 500, true);
    const transactionAt = inventoryDate(body.transaction_at);
    const part = await db.first('SELECT id, quantity, unit_cost_cents FROM parts WHERE id = ? AND workshop_id = ?', partId, auth.workshop_id) as { id: string; quantity: number; unit_cost_cents: number } | undefined;
    if (!part) throw new HttpError(404, 'Part not found.');
    let vehicleId: string | null = null;
    if (jobId) {
      const job = await db.first('SELECT vehicle_id FROM jobs WHERE id = ? AND workshop_id = ?', jobId, auth.workshop_id) as { vehicle_id: string } | undefined;
      if (!job) throw new HttpError(400, 'Select a repair job in this workshop.');
      vehicleId = job.vehicle_id;
    }
    if (delta < 0 && part.quantity < -delta) throw new HttpError(409, 'Insufficient stock for this transaction.');
    if (type === 'return' && jobId) {
      const issued = await db.first('SELECT quantity FROM job_parts WHERE job_id = ? AND part_id = ? AND workshop_id = ?', jobId, partId, auth.workshop_id) as { quantity: number } | undefined;
      if (!issued || issued.quantity < quantity) throw new HttpError(409, 'Returned quantity exceeds parts issued to this repair.');
    }

    const id = await db.transaction(async () => {
      const update = await db.execute('UPDATE parts SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND workshop_id = ? AND quantity + ? >= 0', delta, new Date().toISOString(), partId, auth.workshop_id, delta);
      if (update.affectedRows === 0) throw new HttpError(409, 'Insufficient stock for this transaction.');
      if (type === 'return' && jobId) {
        const returned = await db.execute(`UPDATE job_parts SET quantity = quantity - ?, updated_at = ?
          WHERE job_id = ? AND part_id = ? AND workshop_id = ? AND quantity >= ?`, quantity, new Date().toISOString(), jobId, partId, auth.workshop_id, quantity);
        if (returned.affectedRows === 0) throw new HttpError(409, 'Returned quantity exceeds parts issued to this repair.');
      }
      return await insertStockTransaction({ workshopId: auth.workshop_id, partId, jobId, vehicleId,
        type, delta, unitCostCents: part.unit_cost_cents, note, auth, transactionAt });
    });
    response.status(201).json({ record: await db.first('SELECT * FROM stock_transactions WHERE id = ?', id) });
  } catch (error) { next(error); }
}));

app.get('/api/repairs/:id/parts', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireRepairAccess(request.params.id, auth);
    const records = await db.query(`SELECT jp.id, jp.part_id, jp.quantity, jp.unit_price_cents,
      p.name AS part_name, p.sku AS part_number
      FROM job_parts jp JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
      WHERE jp.job_id = ? AND jp.workshop_id = ? ORDER BY p.name`, request.params.id, auth.workshop_id);
    response.json({ records });
  } catch (error) { next(error); }
}));

// Shared parts-issue operation used by Service & Repair and the mechanic workspace.
// Inventory is updated only through the existing stock transaction mechanism.
async function issueRepairPart(
  job: RepairJobRow,
  body: Record<string, unknown>,
  auth: AuthContext
): Promise<Record<string, unknown>[]> {
  if (Object.keys(body).some((field) => !['part_id', 'quantity', 'note'].includes(field))) {
    throw new HttpError(400, 'Only part, quantity, and note can be provided.');
  }
  const partId = requiredText(body.part_id, 'Part', 1, 36);
  const quantity = inventoryInteger(body.quantity, 'Quantity', 1);
  const note = inventoryText(body.note, 'Note', 500, true);
  const now = new Date().toISOString();

  await db.transaction(async () => {
    const part = await db.first('SELECT quantity, selling_price_cents FROM parts WHERE id = ? AND workshop_id = ?', partId, auth.workshop_id) as { quantity: number; selling_price_cents: number } | undefined;
    if (!part) throw new HttpError(404, 'Part not found.');
    const changed = await db.execute('UPDATE parts SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND workshop_id = ? AND quantity >= ?', quantity, now, partId, auth.workshop_id, quantity);
    if (changed.affectedRows === 0) throw new HttpError(409, 'Insufficient stock. Reduce the quantity or receive more stock first.');
    await db.execute(`INSERT INTO job_parts (id, workshop_id, job_id, part_id, quantity, unit_price_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity),
        unit_price_cents = VALUES(unit_price_cents), updated_at = VALUES(updated_at)`, randomUUID(), auth.workshop_id, job.id, partId, quantity, part.selling_price_cents, now, now);
    await insertStockTransaction({ workshopId: auth.workshop_id, partId, jobId: job.id,
      vehicleId: job.vehicle_id, type: 'repair_issue', delta: -quantity,
      unitCostCents: part.selling_price_cents, note, auth, transactionAt: now });
  });

  return await db.query(`SELECT jp.id, jp.part_id, jp.quantity, jp.unit_price_cents,
    p.name AS part_name, p.sku AS part_number FROM job_parts jp
    JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
    WHERE jp.job_id = ? AND jp.workshop_id = ?`, job.id, auth.workshop_id);
}

app.post('/api/repairs/:id/parts', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const job = await requireRepairAccess(request.params.id, auth);
    const records = await issueRepairPart(job, requireObject(request.body), auth);
    response.status(201).json({ records });
  } catch (error) { next(error); }
}));

app.get('/api/inventory/reports/:reportType', requireAuth, asyncRoute(async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  const reportType = request.params.reportType;
  const reportDefinitions = {
    inventory: { title: 'Inventory Report', filename: 'Inventory_Report' },
    low_stock: { title: 'Low Stock Report', filename: 'Low_Stock_Report' },
    out_of_stock: { title: 'Out-of-Stock Report', filename: 'Out_of_Stock_Report' },
    stock_movement: { title: 'Stock Movement Report', filename: 'Stock_Movement_Report' },
  } as const;
  if (!Object.hasOwn(reportDefinitions, reportType)) throw new HttpError(400, 'Unsupported inventory report.');
  const definition = reportDefinitions[reportType as keyof typeof reportDefinitions];
  const format = request.query.format;
  if (format !== 'pdf' && format !== 'xlsx') throw new HttpError(400, 'Report format must be pdf or xlsx.');
  const dateFrom = request.query.from === undefined ? '' : String(request.query.from);
  const dateTo = request.query.to === undefined ? '' : String(request.query.to);
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsedDate.valueOf()) && parsedDate.toISOString().slice(0, 10) === value;
  };
  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) {
    throw new HttpError(400, 'Report date filters must use YYYY-MM-DD.');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) throw new HttpError(400, 'Start date must be on or before end date.');
  if (reportType !== 'stock_movement' && (dateFrom || dateTo)) {
    throw new HttpError(400, 'Date filters are available for stock movement reports only.');
  }

  let columns: { header: string; key: string; width: number }[];
  let records: Record<string, string | number | null>[];
  let totalInventoryValue: number | null = null;
  if (reportType === 'inventory' || reportType === 'low_stock' || reportType === 'out_of_stock') {
    const stockFilter = reportType === 'low_stock'
      ? 'AND p.quantity <= p.reorder_level'
      : reportType === 'out_of_stock' ? 'AND p.quantity = 0' : '';
    records = await db.query(`SELECT p.name AS part_name, p.sku AS part_number, p.category,
      p.quantity AS available_quantity, p.reorder_level AS minimum_stock,
      p.unit_cost_cents / 100.0 AS purchase_price, p.selling_price_cents / 100.0 AS selling_price,
      COALESCE(s.name, p.supplier, '') AS supplier,
      CASE WHEN p.quantity = 0 THEN 'Out of stock'
        WHEN p.quantity <= p.reorder_level THEN 'Low stock' ELSE 'In stock' END AS stock_status
      FROM parts p LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.workshop_id = p.workshop_id
      WHERE p.workshop_id = ? ${stockFilter} ORDER BY p.name`, auth.workshop_id) as Record<string, string | number | null>[];
    if (reportType === 'inventory') {
      const value = await db.first('SELECT COALESCE(SUM(quantity * unit_cost_cents), 0) / 100.0 AS total FROM parts WHERE workshop_id = ?', auth.workshop_id) as { total: number };
      totalInventoryValue = value.total;
      columns = [
        { header: 'Part name', key: 'part_name', width: 25 }, { header: 'Part number', key: 'part_number', width: 16 },
        { header: 'Category', key: 'category', width: 18 }, { header: 'Available quantity', key: 'available_quantity', width: 14 },
        { header: 'Purchase price', key: 'purchase_price', width: 14 }, { header: 'Selling price', key: 'selling_price', width: 14 },
        { header: 'Supplier', key: 'supplier', width: 24 }, { header: 'Stock status', key: 'stock_status', width: 16 },
      ];
    } else {
      columns = [
        { header: 'Part name', key: 'part_name', width: 28 }, { header: 'Part number', key: 'part_number', width: 18 },
        { header: 'Category', key: 'category', width: 20 }, { header: 'Current quantity', key: 'available_quantity', width: 16 },
        ...(reportType === 'low_stock' ? [{ header: 'Minimum stock', key: 'minimum_stock', width: 16 }] : []),
        { header: 'Purchase price', key: 'purchase_price', width: 16 }, { header: 'Supplier', key: 'supplier', width: 25 },
      ];
    }
  } else {
    const predicates = ['t.workshop_id = ?'];
    const bindings: (string | number)[] = [auth.workshop_id];
    if (dateFrom) { predicates.push('t.transaction_at >= ?'); bindings.push(`${dateFrom}T00:00:00.000Z`); }
    if (dateTo) { predicates.push('t.transaction_at <= ?'); bindings.push(`${dateTo}T23:59:59.999Z`); }
    records = await db.query(`SELECT t.transaction_at AS transaction_date, p.name AS part_name,
      t.quantity_delta AS quantity, t.transaction_type, t.responsible_name AS responsible_staff,
      COALESCE(j.job_no, '') AS repair_job, COALESCE(v.plate, '') AS vehicle
      FROM stock_transactions t JOIN parts p ON p.id = t.part_id AND p.workshop_id = t.workshop_id
      LEFT JOIN jobs j ON j.id = t.job_id AND j.workshop_id = t.workshop_id
      LEFT JOIN vehicles v ON v.id = t.vehicle_id AND v.workshop_id = t.workshop_id
      WHERE ${predicates.join(' AND ')} ORDER BY t.transaction_at DESC, t.created_at DESC`, ...bindings) as Record<string, string | number | null>[];
    columns = [
      { header: 'Transaction date', key: 'transaction_date', width: 24 }, { header: 'Part name', key: 'part_name', width: 28 },
      { header: 'Quantity', key: 'quantity', width: 12 }, { header: 'Transaction type', key: 'transaction_type', width: 18 },
      { header: 'Responsible staff', key: 'responsible_staff', width: 24 }, { header: 'Repair job', key: 'repair_job', width: 18 },
      { header: 'Vehicle', key: 'vehicle', width: 16 },
    ];
  }

  const generatedAt = new Date().toISOString();
  const rangeLabel = reportType === 'stock_movement' && (dateFrom || dateTo)
    ? `Date range: ${dateFrom || 'All time'} to ${dateTo || 'Present'}`
    : 'All current workshop records';
  const filename = `NEXTGEN_${definition.filename}.${format}`;
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'NEXTGEN';
    workbook.created = new Date(generatedAt);
    workbook.subject = definition.title;
    workbook.title = `${definition.title} - NEXTGEN`;
    const sheet = workbook.addWorksheet('Inventory Report', { views: [{ state: 'frozen', ySplit: 4 }] });
    sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell(1, 1).value = 'NEXTGEN | VEHICLE SERVICE & REPAIR';
    sheet.getCell(1, 1).font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173B63' } };
    sheet.getCell(1, 1).alignment = { vertical: 'middle' };
    sheet.getRow(1).height = 30;
    sheet.mergeCells(2, 1, 2, columns.length);
    sheet.getCell(2, 1).value = definition.title;
    sheet.getCell(2, 1).font = { size: 14, bold: true, color: { argb: 'FF173B63' } };
    sheet.mergeCells(3, 1, 3, columns.length);
    sheet.getCell(3, 1).value = `Generated ${new Date(generatedAt).toLocaleString()} · ${rangeLabel}`;
    sheet.getCell(3, 1).font = { size: 10, color: { argb: 'FF64748B' } };
    const header = sheet.getRow(4);
    header.values = columns.map((column) => column.header);
    header.height = 24;
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563A6' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    records.forEach((record) => sheet.addRow(columns.map((column) => record[column.key] ?? '')));
    if (totalInventoryValue !== null) {
      const totalRow = sheet.addRow([]);
      const purchaseColumn = columns.findIndex((column) => column.key === 'purchase_price') + 1;
      sheet.mergeCells(totalRow.number, 1, totalRow.number, Math.max(1, purchaseColumn - 1));
      totalRow.getCell(1).value = 'Total inventory value';
      totalRow.getCell(purchaseColumn).value = totalInventoryValue;
      totalRow.font = { bold: true, color: { argb: 'FF173B63' } };
      totalRow.getCell(purchaseColumn).numFmt = '$#,##0.00';
    }
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
    for (const column of ['purchase_price', 'selling_price']) {
      const index = columns.findIndex((entry) => entry.key === column) + 1;
      if (index > 0) for (let row = 5; row < 5 + records.length; row += 1) sheet.getCell(row, index).numFmt = '$#,##0.00';
    }
    const filenameType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    response.type(filenameType);
    response.send(Buffer.from(await workbook.xlsx.writeBuffer()));
    return;
  }

  response.type('application/pdf');
  const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 34, bufferPages: true, compress: false });
  document.pipe(response);
  const left = 34;
  const pageWidth = 774;
  const printHeader = (pageNumber: number) => {
    document.font('Helvetica-Bold').fontSize(15).fillColor('#173b63').text('NEXTGEN', left, 28);
    document.font('Helvetica').fontSize(8).fillColor('#64748b').text('VEHICLE SERVICE & REPAIR', left + 78, 34);
    document.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(definition.title, left, 56);
    document.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Generated ${new Date(generatedAt).toLocaleString()}  |  ${rangeLabel}`, left, 75, { width: pageWidth });
    document.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Page ${pageNumber}`, 740, 30, { width: 68, align: 'right' });
    if (totalInventoryValue !== null) {
      document.font('Helvetica-Bold').fontSize(9).fillColor('#173b63')
        .text(`Total inventory value: $${totalInventoryValue.toFixed(2)}`, left, 91);
    }
    const y = totalInventoryValue === null ? 96 : 111;
    const widths = columns.map((column) => column.width);
    const widthTotal = widths.reduce((total, width) => total + width, 0);
    let x = left;
    document.rect(left, y, pageWidth, 22).fill('#2563a6');
    columns.forEach((column, index) => {
      const width = pageWidth * widths[index] / widthTotal;
      document.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
        .text(column.header, x + 4, y + 7, { width: width - 8, height: 12, ellipsis: true });
      x += width;
    });
    return { y: y + 22, widths, widthTotal };
  };
  let pageNumber = 1;
  let layout = printHeader(pageNumber);
  records.forEach((record, rowIndex) => {
    if (layout.y > 555) {
      document.addPage();
      pageNumber += 1;
      layout = printHeader(pageNumber);
    }
    const rowY = layout.y;
    if (rowIndex % 2 === 1) document.rect(left, rowY, pageWidth, 22).fill('#f1f5f9');
    let x = left;
    columns.forEach((column, index) => {
      const width = pageWidth * layout.widths[index] / layout.widthTotal;
      const rawValue = record[column.key];
      const value = rawValue === null || rawValue === undefined ? ''
        : (column.key === 'purchase_price' || column.key === 'selling_price')
          ? `$${Number(rawValue).toFixed(2)}`
          : column.key === 'transaction_date' ? new Date(String(rawValue)).toLocaleString()
            : String(rawValue);
      document.font('Helvetica').fontSize(7).fillColor('#1e293b')
        .text(value, x + 4, rowY + 7, { width: width - 8, height: 12, ellipsis: true });
      x += width;
    });
    layout.y += 22;
  });
  if (records.length === 0) {
    document.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text('No records found for this report.', left, layout.y + 14);
  }
  document.end();
}));

// Mechanic Management extends this server and reuses its auth, CSRF, repair workflow,
// activity logging, assignment history, and inventory transaction helpers.
// Registered before the generic /api/:resource routes so mechanic paths are not shadowed.
registerSmartWorkshopCatalogueRoutes({
  app,
  db,
  HttpError,
  requireAuth,
  asyncRoute,
  requireObject,
  requiredText,
  requireVehicleAccess: (vehicleId, auth) => requireDiagnosisVehicleAccess(vehicleId, auth as AuthContext),
});

registerMechanicRoutes({
  app,
  db,
  HttpError,
  requireAuth,
  asyncRoute,
  requireObject,
  requiredText,
  normalizedEmail,
  derivePassword,
  validDate,
  assignRepairMechanic,
  changeRepairStatus: (job, status, note, auth, at) => changeRepairStatus(
    job as Parameters<typeof changeRepairStatus>[0],
    status as Parameters<typeof changeRepairStatus>[1],
    note,
    auth,
    at
  ),
  insertRepairActivity,
  issueRepairPart: (job, body, auth) => issueRepairPart(job as Parameters<typeof issueRepairPart>[0], body, auth),
  repairJob: (id, workshopId, technician) => repairJob(id, workshopId, technician as AuthContext | undefined),
  repairSelect,
  isRepairStatus,
  statusTransitions: STATUS_TRANSITIONS,
  technicianStatuses: TECHNICIAN_STATUSES,
});

app.get('/api/:resource(customers|vehicles|jobs)', requireAuth, authorizeResource('read'), asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const definition = getResource(request.params.resource);
    const rawLimit = request.query.limit;
    const rawOffset = request.query.offset;
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'Pagination requires a limit from 1 to 200 and a non-negative offset.');
    }
    let scope = 'workshop_id = ?';
    const bindings: (string | number)[] = [auth.workshop_id];
    if (auth.role === 'technician' && definition.table === 'jobs') {
      scope += ' AND assigned_technician IN (?, ?)';
      bindings.push(auth.name, auth.id);
    } else if (auth.role === 'technician' && definition.table === 'vehicles') {
      scope += ` AND id IN (
        SELECT vehicle_id FROM jobs
        WHERE workshop_id = ? AND assigned_technician IN (?, ?)
      )`;
      bindings.push(auth.workshop_id, auth.name, auth.id);
    }
    const records = await db.query(`
      SELECT * FROM ${definition.table}
      WHERE ${scope}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, ...bindings, limit, offset);
    response.json({ records });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/:resource(customers|vehicles|jobs)/:id', requireAuth, authorizeResource('read'), asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const definition = getResource(request.params.resource);
    let scope = 'workshop_id = ?';
    const bindings: string[] = [auth.workshop_id];
    if (auth.role === 'technician' && definition.table === 'jobs') {
      scope += ' AND assigned_technician IN (?, ?)';
      bindings.push(auth.name, auth.id);
    } else if (auth.role === 'technician' && definition.table === 'vehicles') {
      scope += ` AND id IN (
        SELECT vehicle_id FROM jobs
        WHERE workshop_id = ? AND assigned_technician IN (?, ?)
      )`;
      bindings.push(auth.workshop_id, auth.name, auth.id);
    }
    const record = await db.first(`
      SELECT * FROM ${definition.table}
      WHERE id = ? AND ${scope}
    `, request.params.id, ...bindings);
    if (!record) throw new HttpError(404, 'That record was not found.');
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/:resource(customers|vehicles|jobs)', requireAuth, authorizeResource('create'), asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const definition = getResource(request.params.resource);
    const values = validateFields(definition.fields, requireObject(request.body), definition.required);
    await checkReferences(definition, values, auth.workshop_id);
    const now = new Date().toISOString();
    const entries = Object.entries(values);
    const columns = ['id', 'workshop_id', ...entries.map(([key]) => key), 'created_at', 'updated_at'];
    const id = randomUUID();
    const bindings = [id, auth.workshop_id, ...entries.map(([, value]) => value), now, now];
    const placeholders = columns.map(() => '?').join(', ');
    if (request.params.resource === 'jobs') {
      const status = repairStatusFromLegacy(typeof values.status === 'string' ? values.status : 'Pending');
      const priority = values.priority === 'urgent' ? 'Urgent' : values.priority === 'high' ? 'High' : 'Normal';

      await db.transaction(async () => {
        await db.execute(`INSERT INTO ${definition.table} (${columns.join(', ')}) VALUES (${placeholders})`, ...bindings);
        await db.execute(`
          UPDATE jobs
          SET tracking_number = ?, repair_status = ?, repair_priority = ?,
            estimated_total_cost_cents = estimated_amount_cents, created_by = ?
          WHERE id = ? AND workshop_id = ?
        `, `NG-${new Date().getFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`,
          status,
          priority,
          auth.id,
          id,
          auth.workshop_id);
        await insertRepairStatusHistory(id, auth.workshop_id, null, status, null, auth, now);

  });

    } else {
      await db.execute(`INSERT INTO ${definition.table} (${columns.join(', ')}) VALUES (${placeholders})`, ...bindings);
    }
    const record = await db.first(`SELECT * FROM ${definition.table} WHERE id = ? AND workshop_id = ?`, id, auth.workshop_id);
    response.status(201).json({ record });
  } catch (error) {
    next(error);
  }
}));

app.patch('/api/:resource(customers|vehicles|jobs)/:id', requireAuth, authorizeResource('update'), asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (request.params.resource === 'vehicles') {
      throw new HttpError(405, 'Use PUT to update a vehicle.');
    }
    if (request.params.resource === 'customers') {
      throw new HttpError(405, 'Use PUT to update a customer profile.');
    }
    const definition = getResource(request.params.resource);
    const values = validateFields(definition.fields, requireObject(request.body), []);
    const entries: [string, string | number | null][] = Object.entries(values);
    if (entries.length === 0) throw new HttpError(400, 'Provide at least one field to update.');
    await checkReferences(definition, values, auth.workshop_id);
    let previousRepairStatus: RepairStatus | undefined;
    let nextRepairStatus: RepairStatus | undefined;
    if (request.params.resource === 'jobs' && values.status !== undefined) {
      const current = await requireRepairAccess(request.params.id, auth);
      previousRepairStatus = current.repair_status;
      nextRepairStatus = repairStatusFromLegacy(String(values.status));
      if (nextRepairStatus !== previousRepairStatus &&
          !STATUS_TRANSITIONS[previousRepairStatus].includes(nextRepairStatus)) {
        throw new HttpError(409, `The status cannot move from ${previousRepairStatus} to ${nextRepairStatus}.`);
      }
      if (auth.role === 'technician' && !TECHNICIAN_STATUSES.has(nextRepairStatus)) {
        throw new HttpError(403, 'Mechanics cannot set this repair status.');
      }
      entries.push(['repair_status', nextRepairStatus]);
    }
    const assignments = entries.map(([field]) => `${field} = ?`);
    let scope = 'id = ? AND workshop_id = ?';
    const scopeBindings: string[] = [request.params.id, auth.workshop_id];
    if (auth.role === 'technician') {
      scope += ' AND assigned_technician IN (?, ?)';
      scopeBindings.push(auth.name, auth.id);
    }
    const now = new Date().toISOString();
    const bindings = [...entries.map(([, value]) => value), now, ...scopeBindings];

    await db.transaction(async () => {
      const result = await db.execute(`
        UPDATE ${definition.table}
        SET ${assignments.join(', ')}, updated_at = ?
        WHERE ${scope}
      `, ...bindings);
      if (result.affectedRows === 0) throw new HttpError(404, 'That record was not found.');
      if (request.params.resource === 'jobs' && nextRepairStatus &&
          previousRepairStatus && nextRepairStatus !== previousRepairStatus) {
        await insertRepairStatusHistory(
          request.params.id,
          auth.workshop_id,
          previousRepairStatus,
          nextRepairStatus,
          null,
          auth,
          now
        );
      }

  });

    const record = await db.first(`SELECT * FROM ${definition.table} WHERE id = ? AND workshop_id = ?`, request.params.id, auth.workshop_id);
    response.json({ record });
  } catch (error) {
    next(error);
  }
}));

app.delete('/api/:resource(customers|vehicles|jobs)/:id', requireAuth, authorizeResource('delete'), asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    if (request.params.resource === 'customers') {
      throw new HttpError(405, 'Customer records cannot be deleted here.');
    }
    const definition = getResource(request.params.resource);
    const result = await db.execute(`DELETE FROM ${definition.table} WHERE id = ? AND workshop_id = ?`, request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'That record was not found.');
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}));

interface CustomerNameIdentity {
  accountId: string;
  customerId: string;
  workshopId: string;
  displayName: string;
}

async function findCustomerByName(
  name: string,
  createAccountWhenMissing: boolean
): Promise<CustomerNameIdentity | null> {
  const normalizedName = name.trim().toLowerCase();
  const linked = await db.query<{
    account_id: string;
    customer_id: string;
    workshop_id: string;
    display_name: string;
  }>(`
    SELECT ca.id AS account_id, c.id AS customer_id, c.workshop_id, c.display_name
    FROM customer_accounts ca
    JOIN customers c ON c.id = ca.customer_id AND c.workshop_id = ca.workshop_id
    WHERE LOWER(c.display_name) = ?
    LIMIT 2
  `, normalizedName);

  if (linked.length === 1) {
    const row = linked[0];
    return {
      accountId: row.account_id,
      customerId: row.customer_id,
      workshopId: row.workshop_id,
      displayName: row.display_name,
    };
  }
  if (linked.length > 1) return null;
  if (!createAccountWhenMissing) return null;

  // A workshop may have customer records created before customer accounts existed.
  // Link the existing customer record once; never create a second customer identity.
  const candidates = await db.query<{
    id: string;
    workshop_id: string;
    customer_code: string | null;
    display_name: string;
    email: string | null;
  }>(`
    SELECT c.id, c.workshop_id, c.customer_code, c.display_name, c.email
    FROM customers c
    WHERE LOWER(c.display_name) = ?
    LIMIT 2
  `, normalizedName);
  if (candidates.length !== 1) return null;

  const customer = candidates[0];
  const accountId = randomUUID();
  const now = sessionClockNow();
  const salt = randomBytes(16);
  // The stored secret is intentionally unusable. Customer sessions are granted by registered name.
  const passwordHash = await derivePassword(randomBytes(32).toString('hex'), salt);
  const resolvedUsername = customer.customer_code?.slice(0, 191) ?? null;
  const accountEmail = customer.email?.trim() || `${customer.id}@customer.local`;
  await db.execute(`
    INSERT INTO customer_accounts (
      id, customer_id, workshop_id, username, email, password_hash, password_salt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, accountId, customer.id, customer.workshop_id, resolvedUsername, accountEmail,
    passwordHash.toString('hex'), salt.toString('hex'), now, now);
  return {
    accountId,
    customerId: customer.id,
    workshopId: customer.workshop_id,
    displayName: customer.display_name,
  };
}

app.post('/api/customer/auth/name', limitCustomerNameLogin, asyncRoute(async (request, response) => {
  const body = requireObject(request.body);
  const name = requiredText(body.name, 'Customer name', 2, 191);
  const identity = await findCustomerByName(name, true);
  if (!identity) throw new HttpError(401, 'No unique customer matched that name.');

  const csrf = readCookie(request, CSRF_COOKIE);
  if (!csrf || !/^[a-f0-9]{64}$/.test(csrf)) throw new HttpError(403, 'csrf_validation_failed');

  const tokens = await createCustomerSession(
    { id: identity.accountId, customer_id: identity.customerId, workshop_id: identity.workshopId },
    csrf
  );
  setCustomerAuthCookies(response, tokens.accessToken, tokens.refreshToken, csrf);
  response.json({
    customer: {
      id: identity.customerId,
      display_name: identity.displayName,
    },
  });
}));

// Legacy secret-based customer routes remain registered so older clients receive a clear
// replacement message. Customer sessions are granted by the registered customer name only.
app.post('/api/customer/auth/register', (_request, response) => {
  response.status(410).json({
    error: 'customer_registration_disabled',
    message: 'Customer access uses your registered customer name.',
  });
});

app.post('/api/customer/auth/login', (_request, response) => {
  response.status(410).json({
    error: 'customer_login_disabled',
    message: 'Customer access uses your registered customer name.',
  });
});

app.post('/api/customer/auth/refresh', limitAuthAttempts, asyncRoute(async (request, response) => {
  const token = readCookie(request, CUSTOMER_REFRESH_COOKIE);
  if (!token) {
    clearCustomerAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_required' });
    return;
  }

  let claims: JwtClaims;
  try {
    claims = verifyJwt(token, 'refresh');
  } catch (error) {
    clearCustomerAuthCookies(response);
    response.status(401).json({ error: error instanceof JwtError && error.code === 'expired' ? 'refresh_token_expired' : 'refresh_token_invalid' });
    return;
  }

  const csrfCookie = readCookie(request, CSRF_COOKIE);
  if (!isCustomerRole(claims.role) || !csrfCookie || !constantTimeMatch(csrfCookie, claims.csrf)) {
    clearCustomerAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_invalid' });
    return;
  }

  const tokenRow = await db.first(`
    SELECT tok.jti, tok.session_id, tok.revoked_at, tok.replaced_by_jti,
           cs.revoked_at AS session_revoked_at, cs.absolute_expires_at,
           ca.id AS account_id, ca.customer_id, ca.workshop_id, ca.updated_at
    FROM customer_jwt_tokens tok
    JOIN customer_sessions cs ON cs.id = tok.session_id
    JOIN customer_accounts ca ON ca.id = cs.customer_account_id
    WHERE tok.jti = ? AND tok.token_type = 'refresh'
      AND cs.id = ? AND ca.customer_id = ? AND ca.workshop_id = ?
  `, claims.jti, claims.sid, claims.sub, claims.wid) as {
    jti: string;
    session_id: string;
    revoked_at: string | null;
    replaced_by_jti: string | null;
    session_revoked_at: string | null;
    absolute_expires_at: string;
    account_id: string;
    customer_id: string;
    workshop_id: string;
    updated_at: string;
  } | undefined;

  const absoluteExpiry = tokenRow ? new Date(tokenRow.absolute_expires_at).getTime() : Number.NaN;
  const accountUpdated = tokenRow ? new Date(tokenRow.updated_at).getTime() : Number.NaN;
  const invalid =
    !tokenRow ||
    tokenRow.revoked_at !== null ||
    tokenRow.session_revoked_at !== null ||
    (Number.isFinite(absoluteExpiry) && absoluteExpiry <= Date.now()) ||
    (Number.isFinite(accountUpdated) && claims.iat * 1000 < accountUpdated);

  if (invalid) {
    // Reuse of an already-rotated refresh token revokes the whole session family.
    if (tokenRow?.revoked_at) await revokeCustomerSession(tokenRow.session_id);
    clearCustomerAuthCookies(response);
    response.status(401).json({ error: 'refresh_token_revoked' });
    return;
  }

  const csrf = createCsrfToken();
  const absoluteSeconds = Math.floor(new Date(tokenRow.absolute_expires_at).getTime() / 1000);
  const pair = await db.transaction(async () => {
    const issued = await issueCustomerTokenPair(
      tokenRow.session_id,
      { id: tokenRow.account_id, customer_id: tokenRow.customer_id, workshop_id: tokenRow.workshop_id },
      csrf,
      absoluteSeconds
    );
    await revokeCustomerToken(claims.jti, issued.refreshJti);
    return issued;
  });
  setCustomerAuthCookies(response, pair.accessToken, pair.refreshToken, csrf);
  response.json({ refreshed: true });
}));

app.post('/api/customer/auth/logout', asyncRoute(async (request, response) => {
  for (const [cookie, type] of [
    [CUSTOMER_ACCESS_COOKIE, 'access'],
    [CUSTOMER_REFRESH_COOKIE, 'refresh'],
  ] as const) {
    const token = readCookie(request, cookie);
    if (!token) continue;
    try {
      const claims = verifyJwt(token, type);
      if (!isCustomerRole(claims.role)) continue;
      const row = await db.first('SELECT session_id FROM customer_jwt_tokens WHERE jti = ? AND token_type = ?', claims.jti, type) as { session_id: string } | undefined;
      if (row) await revokeCustomerSession(row.session_id);
      break;
    } catch (error) {
      if (!(error instanceof JwtError)) throw error;
    }
  }
  clearCustomerAuthCookies(response);
  response.status(204).end();
}));

app.get('/api/customer/auth/me', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const auth = response.locals.customer as {
    customer_id: string;
    workshop_id: string;
    email: string;
    display_name: string;
  };
  response.json({
    customer: {
      id: auth.customer_id,
      display_name: auth.display_name,
      email: auth.email,
      workshop_id: auth.workshop_id,
    },
  });
}));

app.get('/api/customer/vehicles', requireCustomerAuth, asyncRoute(async (request, response) => {
  const customer = response.locals.customer as { customer_id: string; workshop_id: string };
  const vehicles = await db.query(`
    SELECT v.id, v.plate, v.vin AS vin, v.engine_number, v.make, v.model,
      v.model_year, v.color, v.mileage, v.engine_type, v.engine_capacity_cc,
      v.fuel_type, v.transmission_type, v.drive_type, v.created_at, v.updated_at,
      vm.name AS catalogue_model_name, vm.body_style, vm.specification_note
    FROM vehicles v
    LEFT JOIN vehicle_models vm ON vm.id = v.catalogue_model_id
    WHERE v.customer_id = ? AND v.workshop_id = ?
    ORDER BY v.created_at DESC
  `, customer.customer_id, customer.workshop_id);
  response.json({ vehicles });
}));

app.get('/api/customer/vehicles/:vehicleId/jobs', requireCustomerAuth, asyncRoute(async (request, response, next) => {
  try {
    const customer = response.locals.customer as { customer_id: string; workshop_id: string };
    const vehicle = await db.first('SELECT id FROM vehicles WHERE id = ? AND customer_id = ? AND workshop_id = ?', request.params.vehicleId, customer.customer_id, customer.workshop_id);
    if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
    const jobs = await db.query(`
      SELECT j.id, j.job_no, j.service_type, j.issue_description, j.status, j.repair_status,
        j.repair_priority, j.promised_at, j.created_at, j.updated_at,
        m.full_name AS assigned_mechanic_name, m.specialization AS assigned_mechanic_specialization
      FROM jobs j
      LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
      WHERE j.vehicle_id = ? AND j.workshop_id = ?
      ORDER BY j.created_at DESC
    `, request.params.vehicleId, customer.workshop_id);
    response.json({ jobs });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customer/jobs/:jobId/status-history', requireCustomerAuth, asyncRoute(async (request, response, next) => {
  try {
    const customer = response.locals.customer as { customer_id: string; workshop_id: string };
    const job = await db.first('SELECT vehicle_id FROM jobs WHERE id = ? AND workshop_id = ?', request.params.jobId, customer.workshop_id) as { vehicle_id: string } | undefined;
    if (!job) throw new HttpError(404, 'Job not found.');
    const vehicle = await db.first('SELECT id FROM vehicles WHERE id = ? AND customer_id = ? AND workshop_id = ?', job.vehicle_id, customer.customer_id, customer.workshop_id);
    if (!vehicle) throw new HttpError(404, 'Job not found.');
    const history = await db.query(`
      SELECT previous_status, new_status, note, changed_by_name, changed_at
      FROM repair_status_history
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY changed_at ASC
    `, request.params.jobId, customer.workshop_id);
    response.json({ history });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/customer/vehicles/:vehicleId/service-history', requireCustomerAuth, asyncRoute(async (request, response, next) => {
  try {
    const customer = customerPortalIdentity(response);
    await requireCustomerVehicle(request.params.vehicleId, customer);
    const serviceHistory = await db.query(`
      SELECT j.id, j.job_no, j.service_type, j.status, j.repair_status,
        j.created_at, j.updated_at, j.promised_at,
        m.full_name AS assigned_mechanic_name
      FROM jobs j
      LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
      LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
      WHERE j.vehicle_id = ? AND j.workshop_id = ?
      ORDER BY j.created_at DESC
    `, request.params.vehicleId, customer.workshop_id);
    response.json({ service_history: serviceHistory });
  } catch (error) {
    next(error);
  }
}));

/* -------------------------------------------------------------------------- */
/* Customer portal: dashboard, vehicles, repairs, billing, notifications, profile */
/* -------------------------------------------------------------------------- */

interface CustomerPortalIdentity {
  account_id: string;
  customer_id: string;
  workshop_id: string;
  email: string;
  display_name: string;
}

function customerPortalIdentity(response: Response): CustomerPortalIdentity {
  return response.locals.customer as CustomerPortalIdentity;
}

function toAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function withStage<T extends object>(record: T) {
  const status = (record as { repair_status?: unknown }).repair_status;
  const normalized = typeof status === 'string' ? status : null;
  return {
    ...record,
    stage: repairStageLabel(normalized),
    stage_index: repairStageIndex(normalized),
  };
}

async function requireCustomerVehicle(vehicleId: string, customer: CustomerPortalIdentity) {
  const vehicle = await db.first(`
    SELECT id, plate, make, model, model_year, vin, engine_number
    FROM vehicles
    WHERE id = ? AND customer_id = ? AND workshop_id = ?
  `, vehicleId, customer.customer_id, customer.workshop_id);
  if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
  return vehicle;
}

async function requireCustomerJob(jobId: string, customer: CustomerPortalIdentity) {
  const job = await db.first(`
    SELECT j.id, j.job_no, j.service_type, j.issue_description, j.repair_status,
      j.repair_priority, j.status, j.promised_at, j.created_at, j.updated_at,
      j.final_amount_cents, j.estimated_total_cost_cents,
      j.estimated_labour_cost_cents, j.estimated_parts_cost_cents,
      v.id AS vehicle_id, v.plate AS registration_number, v.make, v.model, v.model_year,
      m.full_name AS assigned_mechanic_name, m.specialization AS assigned_mechanic_specialization
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
    LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
    LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
    WHERE j.id = ? AND j.workshop_id = ? AND v.customer_id = ?
  `, jobId, customer.workshop_id, customer.customer_id);
  if (!job) throw new HttpError(404, 'Repair job not found.');
  return job;
}

app.get('/api/customer/dashboard', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const profile = await db.first<{
    id: string;
    username: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  }>(`
    SELECT c.id, COALESCE(ca.username, c.customer_code) AS username,
      c.display_name AS full_name, c.email, c.phone, c.address
    FROM customers c
    LEFT JOIN customer_accounts ca
      ON ca.customer_id = c.id AND ca.workshop_id = c.workshop_id
    WHERE c.id = ? AND c.workshop_id = ?
  `, customer.customer_id, customer.workshop_id);
  if (!profile) throw new HttpError(404, 'Customer profile not found.');

  const [vehicleCount, activeJobs, completedRepairs, pendingPayments, notifications, recentJobs] = await Promise.all([
    db.first<{ count: number }>(`
      SELECT COUNT(*) AS count FROM vehicles
      WHERE customer_id = ? AND workshop_id = ?
    `, customer.customer_id, customer.workshop_id),
    db.first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE v.customer_id = ? AND j.workshop_id = ?
        AND COALESCE(j.repair_status, 'Received') NOT IN ('Collected')
    `, customer.customer_id, customer.workshop_id),
    db.first<{ count: number }>(`
      SELECT COUNT(*) AS count
      FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE v.customer_id = ? AND j.workshop_id = ?
        AND COALESCE(j.repair_status, 'Received') IN ('Repair Completed', 'Ready for Collection', 'Collected')
    `, customer.customer_id, customer.workshop_id),
    db.first<{ cents: number }>(`
      SELECT COALESCE(SUM(GREATEST(0,
        GREATEST(recorded_amount, paid_cents + pending_rows_cents) - paid_cents
      )), 0) AS cents
      FROM (
        SELECT j.id,
          CASE
            WHEN j.final_amount_cents IS NOT NULL THEN j.final_amount_cents
            ELSE COALESCE(j.estimated_total_cost_cents, 0)
              + CASE WHEN COALESCE(j.estimated_total_cost_cents, 0) = 0
                THEN COALESCE(j.estimated_labour_cost_cents, 0) + COALESCE(j.estimated_parts_cost_cents, 0)
                ELSE 0 END
          END AS recorded_amount,
          COALESCE(paid.paid_cents, 0) AS paid_cents,
          COALESCE(paid.pending_rows_cents, 0) AS pending_rows_cents
        FROM jobs j
        JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
        LEFT JOIN (
          SELECT job_id, workshop_id,
            SUM(CASE WHEN LOWER(COALESCE(status, '')) = 'paid' THEN amount_cents ELSE 0 END) AS paid_cents,
            SUM(CASE WHEN LOWER(COALESCE(status, '')) <> 'paid' THEN amount_cents ELSE 0 END) AS pending_rows_cents
          FROM payments
          WHERE workshop_id = ?
          GROUP BY job_id, workshop_id
        ) paid ON paid.job_id = j.id AND paid.workshop_id = j.workshop_id
        WHERE v.customer_id = ? AND j.workshop_id = ?
      ) amounts
    `, customer.workshop_id, customer.customer_id, customer.workshop_id),
    db.query<{
      id: string;
      job_id: string | null;
      type: string;
      title: string;
      message: string;
      is_read: number;
      created_at: string;
    }>(`
      SELECT id, job_id, type, title, message, is_read, created_at
      FROM customer_notifications
      WHERE customer_id = ? AND workshop_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, customer.customer_id, customer.workshop_id),
    db.query<{
      id: string;
      job_no: string;
      service_type: string;
      repair_status: string | null;
      registration_number: string;
      created_at: string;
    }>(`
      SELECT j.id, j.job_no, j.service_type, j.repair_status,
        v.plate AS registration_number, j.created_at
      FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      WHERE v.customer_id = ? AND j.workshop_id = ?
      ORDER BY j.created_at DESC
      LIMIT 5
    `, customer.customer_id, customer.workshop_id),
  ]);

  response.json({
    profile,
    summary: {
      total_vehicles: toAmount(vehicleCount?.count),
      active_jobs: toAmount(activeJobs?.count),
      completed_repairs: toAmount(completedRepairs?.count),
      pending_payment_cents: toAmount(pendingPayments?.cents),
    },
    recent_notifications: notifications,
    recent_jobs: recentJobs.map(withStage),
    stages: REPAIR_TRACKING_STAGES,
  });
}));

app.get('/api/customer/profile', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const profile = await db.first(`
    SELECT c.id, COALESCE(ca.username, c.customer_code) AS username,
      c.customer_code, c.display_name AS full_name, c.email, c.phone,
      c.address, c.gender, c.created_at, c.updated_at,
      ca.email AS account_email, ca.created_at AS account_created_at
    FROM customers c
    LEFT JOIN customer_accounts ca
      ON ca.customer_id = c.id AND ca.workshop_id = c.workshop_id
    WHERE c.id = ? AND c.workshop_id = ?
  `, customer.customer_id, customer.workshop_id);
  if (!profile) throw new HttpError(404, 'Customer profile not found.');
  response.json({ profile });
}));

app.patch('/api/customer/profile', requireCustomerAuth, asyncRoute(async (request, response) => {
  const customer = customerPortalIdentity(response);
  const body = requireObject(request.body);
  const assignments: string[] = [];
  const values: (string | null)[] = [];

  if (body.phone !== undefined) {
    const phone = normalizedPhone(body.phone);
    assignments.push('phone = ?', 'phone_normalized = ?');
    values.push(phone.phone, phone.normalized);
  }
  if (body.address !== undefined) {
    assignments.push('address = ?');
    values.push(body.address === '' || body.address === null ? null : requiredText(body.address, 'Address', 1, 500));
  }
  if (assignments.length === 0) {
    throw new HttpError(400, 'Provide at least one permitted profile field.');
  }

  const now = sessionClockNow();
  try {
    await db.execute(`
      UPDATE customers SET ${assignments.join(', ')}, updated_at = ?
      WHERE id = ? AND workshop_id = ?
    `, ...values, now, customer.customer_id, customer.workshop_id);
  } catch (error) {
    if (error instanceof Error && /duplicate|ER_DUP_ENTRY/i.test(error.message)) {
      throw new HttpError(409, 'That phone number is already registered in this workshop.');
    }
    throw error;
  }
  response.json({ updated: true });
}));

app.get('/api/customer/jobs', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const jobs = await db.query<{
    id: string;
    job_no: string;
    service_type: string;
    issue_description: string | null;
    repair_status: string | null;
    repair_priority: string | null;
    promised_at: string | null;
    created_at: string;
    updated_at: string;
    registration_number: string;
    make: string;
    model: string;
    assigned_mechanic_name: string | null;
  }>(`
    SELECT j.id, j.job_no, j.service_type, j.issue_description, j.repair_status,
      j.repair_priority, j.promised_at, j.created_at, j.updated_at,
      v.plate AS registration_number, v.make, v.model,
      m.full_name AS assigned_mechanic_name
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
    LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
    LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
    WHERE v.customer_id = ? AND j.workshop_id = ?
    ORDER BY j.created_at DESC
  `, customer.customer_id, customer.workshop_id);
  response.json({ jobs: jobs.map(withStage), stages: REPAIR_TRACKING_STAGES });
}));

app.get('/api/customer/jobs/:jobId', requireCustomerAuth, asyncRoute(async (request, response) => {
  const customer = customerPortalIdentity(response);
  const job = await requireCustomerJob(request.params.jobId, customer);
  const [statusHistory, activities, parts, notifications, partsTotal] = await Promise.all([
    db.query<{
      previous_status: string | null;
      new_status: string | null;
      note: string | null;
      changed_by_name: string | null;
      changed_at: string;
    }>(`
      SELECT previous_status, new_status, note, changed_by_name, changed_at
      FROM repair_status_history
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY changed_at DESC
    `, job.id, customer.workshop_id),
    db.query<{
      activity_type: string | null;
      work_performed: string | null;
      inspection_findings: string | null;
      problems_identified: string | null;
      recommendations: string | null;
      additional_work_required: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(`
      SELECT activity_type, work_performed, inspection_findings, problems_identified,
        recommendations, additional_work_required, created_by_name, created_at
      FROM repair_activity_logs
      WHERE job_id = ? AND workshop_id = ?
      ORDER BY created_at DESC
    `, job.id, customer.workshop_id),
    db.query<{
      id: string;
      part_name: string;
      part_number: string;
      quantity: number;
      unit_price_cents: number;
    }>(`
      SELECT jp.id, p.name AS part_name, p.sku AS part_number,
        jp.quantity, jp.unit_price_cents
      FROM job_parts jp
      JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
      WHERE jp.job_id = ? AND jp.workshop_id = ?
      ORDER BY p.name
    `, job.id, customer.workshop_id),
    db.query<{
      id: string;
      title: string;
      message: string;
      is_read: number;
      created_at: string;
    }>(`
      SELECT id, title, message, is_read, created_at
      FROM customer_notifications
      WHERE job_id = ? AND customer_id = ? AND workshop_id = ?
      ORDER BY created_at DESC
    `, job.id, customer.customer_id, customer.workshop_id),
    db.first<{ cents: number }>(`
      SELECT COALESCE(SUM(quantity * unit_price_cents), 0) AS cents
      FROM job_parts WHERE job_id = ? AND workshop_id = ?
    `, job.id, customer.workshop_id),
  ]);

  const timeline = [
    ...statusHistory.map((entry) => ({
      kind: 'status',
      title: repairStageLabel(entry.new_status),
      detail: entry.note,
      actor: entry.changed_by_name,
      at: entry.changed_at,
    })),
    ...activities.map((entry) => ({
      kind: 'work',
      title: entry.activity_type || 'Workshop update',
      detail: [
        entry.work_performed,
        entry.inspection_findings,
        entry.problems_identified,
        entry.recommendations,
        entry.additional_work_required,
      ].filter(Boolean).join(' · ') || null,
      actor: entry.created_by_name,
      at: entry.created_at,
    })),
  ].sort((left, right) => String(right.at).localeCompare(String(left.at)));

  response.json({
    job: {
      ...withStage(job),
      parts_charges_cents: toAmount(partsTotal?.cents),
    },
    timeline,
    parts,
    notifications,
    stages: REPAIR_TRACKING_STAGES,
  });
}));

app.get('/api/customer/service-history', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const records = await db.query<{
    id: string;
    job_no: string;
    service_type: string;
    issue_description: string | null;
    repair_status: string | null;
    service_date: string;
    completed_at: string;
    registration_number: string;
    make: string;
    model: string;
    model_year: number;
    assigned_mechanic_name: string | null;
    work_performed: string | null;
    parts_summary: string | null;
    parts_charges_cents: number;
    final_amount_cents: number | null;
    estimated_total_cost_cents: number;
  }>(`
    SELECT j.id, j.job_no, j.service_type, j.issue_description, j.repair_status,
      j.created_at AS service_date, j.updated_at AS completed_at,
      v.plate AS registration_number, v.make, v.model, v.model_year,
      m.full_name AS assigned_mechanic_name,
      (
        SELECT COALESCE(a.work_performed, a.inspection_findings, a.recommendations)
        FROM repair_activity_logs a
        WHERE a.job_id = j.id AND a.workshop_id = j.workshop_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
      ) AS work_performed,
      (
        SELECT GROUP_CONCAT(CONCAT(p.name, ' x', jp.quantity) SEPARATOR ', ')
        FROM job_parts jp
        JOIN parts p ON p.id = jp.part_id AND p.workshop_id = jp.workshop_id
        WHERE jp.job_id = j.id AND jp.workshop_id = j.workshop_id
      ) AS parts_summary,
      (
        SELECT COALESCE(SUM(jp.quantity * jp.unit_price_cents), 0)
        FROM job_parts jp
        WHERE jp.job_id = j.id AND jp.workshop_id = j.workshop_id
      ) AS parts_charges_cents,
      j.final_amount_cents, j.estimated_total_cost_cents
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
    LEFT JOIN users u ON u.id = j.assigned_technician AND u.workshop_id = j.workshop_id
    LEFT JOIN mechanics m ON m.user_id = u.id AND m.workshop_id = j.workshop_id
    WHERE v.customer_id = ? AND j.workshop_id = ?
      AND COALESCE(j.repair_status, 'Received') IN ('Repair Completed', 'Ready for Collection', 'Collected')
    ORDER BY j.created_at DESC
  `, customer.customer_id, customer.workshop_id);
  response.json({ records: records.map(withStage) });
}));

app.get('/api/customer/billing', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const [invoiceRows, payments] = await Promise.all([
    db.query<{
      job_id: string;
      invoice_number: string | null;
      job_no: string;
      service_type: string;
      registration_number: string;
      make: string;
      model: string;
      final_amount_cents: number | null;
      estimated_total_cost_cents: number;
      estimated_labour_cost_cents: number;
      estimated_parts_cost_cents: number;
      parts_charges_cents: number;
      paid_cents: number;
      pending_cents: number;
      latest_paid_at: string | null;
      created_at: string;
    }>(`
      SELECT j.id AS job_id, MAX(p.invoice_number) AS invoice_number,
        j.job_no, j.service_type, v.plate AS registration_number, v.make, v.model,
        j.final_amount_cents, j.estimated_total_cost_cents,
        j.estimated_labour_cost_cents, j.estimated_parts_cost_cents,
        (
          SELECT COALESCE(SUM(jp.quantity * jp.unit_price_cents), 0)
          FROM job_parts jp
          WHERE jp.job_id = j.id AND jp.workshop_id = j.workshop_id
        ) AS parts_charges_cents,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(p.status, '')) = 'paid' THEN p.amount_cents ELSE 0 END), 0) AS paid_cents,
        COALESCE(SUM(CASE WHEN LOWER(COALESCE(p.status, '')) <> 'paid' THEN p.amount_cents ELSE 0 END), 0) AS pending_cents,
        MAX(p.paid_at) AS latest_paid_at, j.created_at
      FROM jobs j
      JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
      LEFT JOIN payments p ON p.job_id = j.id AND p.workshop_id = j.workshop_id
      WHERE j.workshop_id = ? AND v.customer_id = ?
        AND (
          j.final_amount_cents IS NOT NULL
          OR COALESCE(j.estimated_total_cost_cents, 0) > 0
          OR (COALESCE(j.estimated_labour_cost_cents, 0) + COALESCE(j.estimated_parts_cost_cents, 0)) > 0
          OR EXISTS (
            SELECT 1 FROM payments p2
            WHERE p2.job_id = j.id AND p2.workshop_id = j.workshop_id
          )
        )
      GROUP BY j.id, j.job_no, j.service_type, v.plate, v.make, v.model,
        j.final_amount_cents, j.estimated_total_cost_cents,
        j.estimated_labour_cost_cents, j.estimated_parts_cost_cents, j.created_at
      ORDER BY j.created_at DESC
    `, customer.workshop_id, customer.customer_id),
    db.query<{
      id: string;
      invoice_number: string;
      job_id: string | null;
      job_no: string;
      amount_cents: number;
      payment_method: string;
      status: string;
      paid_at: string | null;
      created_at: string;
    }>(`
      SELECT p.id, p.invoice_number, p.job_id, j.job_no, p.amount_cents,
        p.payment_method, p.status, p.paid_at, p.created_at
      FROM payments p
      LEFT JOIN jobs j ON j.id = p.job_id AND j.workshop_id = p.workshop_id
      WHERE p.workshop_id = ? AND j.id IN (
        SELECT j2.id FROM jobs j2
        JOIN vehicles v ON v.id = j2.vehicle_id AND v.workshop_id = j2.workshop_id
        WHERE v.customer_id = ? AND j2.workshop_id = ?
      )
      ORDER BY p.created_at DESC
    `, customer.workshop_id, customer.customer_id, customer.workshop_id),
  ]);

  const invoices = invoiceRows.map((row) => {
    const partsCharges = toAmount(row.parts_charges_cents);
    const hasFinal = row.final_amount_cents !== null && row.final_amount_cents !== undefined;
    const estimate = toAmount(row.estimated_total_cost_cents)
      || toAmount(row.estimated_labour_cost_cents) + toAmount(row.estimated_parts_cost_cents);
    const total = hasFinal ? toAmount(row.final_amount_cents) : estimate || partsCharges;
    const paid = toAmount(row.paid_cents);
    const serviceCharges = Math.max(0, total - partsCharges);
    const outstanding = Math.max(0, total - paid);
    return {
      ...row,
      total_amount_cents: total,
      total_source: hasFinal
        ? 'Recorded final amount'
        : estimate
          ? 'Estimate recorded on the job card'
          : partsCharges
            ? 'Issued parts recorded on the job card'
            : 'No amount recorded',
      service_charges_cents: serviceCharges,
      spare_parts_charges_cents: partsCharges,
      amount_paid_cents: paid,
      outstanding_cents: outstanding,
      payment_status: outstanding === 0 && paid > 0
        ? 'Paid'
        : paid > 0 ? 'Partially paid' : total > 0 ? 'Amount not settled' : 'Not recorded',
    };
  });

  response.json({ invoices, payments });
}));

app.get('/api/customer/notifications', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const [notifications, unread] = await Promise.all([
    db.query<{
      id: string;
      job_id: string | null;
      type: string;
      title: string;
      message: string;
      is_read: number;
      created_at: string;
      read_at: string | null;
    }>(`
      SELECT id, job_id, type, title, message, is_read, created_at, read_at
      FROM customer_notifications
      WHERE customer_id = ? AND workshop_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, customer.customer_id, customer.workshop_id),
    db.first<{ count: number }>(`
      SELECT COUNT(*) AS count FROM customer_notifications
      WHERE customer_id = ? AND workshop_id = ? AND is_read = 0
    `, customer.customer_id, customer.workshop_id),
  ]);
  response.json({ notifications, unread_count: toAmount(unread?.count) });
}));

app.patch('/api/customer/notifications/read-all', requireCustomerAuth, asyncRoute(async (_request, response) => {
  const customer = customerPortalIdentity(response);
  const now = sessionClockNow();
  await db.execute(`
    UPDATE customer_notifications
    SET is_read = 1, read_at = ?
    WHERE customer_id = ? AND workshop_id = ? AND is_read = 0
  `, now, customer.customer_id, customer.workshop_id);
  response.json({ updated: true });
}));

app.patch('/api/customer/notifications/:id/read', requireCustomerAuth, asyncRoute(async (request, response) => {
  const customer = customerPortalIdentity(response);
  const result = await db.execute(`
    UPDATE customer_notifications
    SET is_read = 1, read_at = ?
    WHERE id = ? AND customer_id = ? AND workshop_id = ?
  `, sessionClockNow(), request.params.id, customer.customer_id, customer.workshop_id);
  if (result.affectedRows === 0) throw new HttpError(404, 'Notification not found.');
  response.json({ updated: true });
}));

/* -------------------------------------------------------------------------- */
/* Adaptive learning, workshop intelligence, twin and visual localisation APIs  */
/* -------------------------------------------------------------------------- */

function requireIntelligenceStaff(auth: AuthContext): void {
  if (!isStaffRole(auth.role)) throw new HttpError(403, 'role_forbidden');
}

function queryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

app.post('/api/ai/retrain', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const mixedDataset = resolve(process.cwd(), 'ml', 'data', 'vehicle_fault_training_mixed.csv');
    const dataset = existsSync(mixedDataset)
      ? mixedDataset
      : resolve(process.cwd(), 'ml', 'data', 'vehicle_fault_training.csv');
    const runId = randomUUID();
    const startedAt = sessionClockNow();
    await db.execute(`
      INSERT INTO ai_training_runs (
        id, workshop_id, initiated_by_user_id, initiated_by_name, dataset_path,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, runId, auth.workshop_id, auth.id, auth.name, dataset, 'running', startedAt);

    const python = process.env.PYTHON_EXECUTABLE ?? (process.platform === 'win32' ? 'python' : 'python3');
    const child = spawn(python, [
      resolve(process.cwd(), 'ml', 'diagnosis.py'), 'retrain', '--dataset', dataset,
    ], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk.slice(0, 1_000_000); });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_000); });

    const outcome = await new Promise<{ code: number | null; error?: string }>((resolveRun) => {
      const timer = setTimeout(() => child.kill(), 180_000);
      child.on('error', (error) => {
        clearTimeout(timer);
        resolveRun({ code: null, error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolveRun({ code });
      });
    });

    let result: Record<string, unknown> = {};
    try {
      const jsonLine = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
      if (jsonLine) result = JSON.parse(jsonLine) as Record<string, unknown>;
    } catch {
      result = { raw_output: stdout.slice(0, 2000) };
    }
    const finishedAt = sessionClockNow();
    const status = outcome.code === 0 && !outcome.error ? 'succeeded' : 'failed';
    const message = status === 'failed' ? ((outcome.error ?? stderr.trim()) || `Python exited with ${outcome.code}`) : null;
    await db.execute(`
      UPDATE ai_training_runs
      SET status = ?, model_version = ?, provenance_json = ?, metrics_json = ?, error_text = ?, finished_at = ?
      WHERE id = ?
    `, status, typeof result.model_version === 'string' ? result.model_version : null,
      JSON.stringify(result.provenance_counts ?? result.provenance ?? null),
      JSON.stringify(result.evaluation ?? null), message, finishedAt, runId);
    if (status === 'failed') throw new HttpError(502, `Model retraining failed: ${message}`);
    response.json({ run: { id: runId, status, model_version: result.model_version ?? null, dataset: dataset }, result });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/ai/training-runs', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const runs = await db.query(`
      SELECT id, dataset_path, status, model_version, provenance_json, metrics_json,
             error_text, initiated_by_name, created_at, finished_at
      FROM ai_training_runs WHERE workshop_id = ? ORDER BY created_at DESC LIMIT 25
    `, auth.workshop_id);
    response.json({ runs });
  } catch (error) {
    next(error);
  }
}));

app.get('/api/workshop/bays', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    const bays = await db.query(`
      SELECT id, code, label, is_active FROM workshop_bays
      WHERE workshop_id = ? ORDER BY code
    `, auth.workshop_id);
    response.json({ bays });
  } catch (error) { next(error); }
}));

app.post('/api/workshop/bays', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const code = requiredText(body.code, 'Bay code', 1, 80);
    const label = body.label === undefined ? null : requiredText(body.label, 'Bay label', 1, 160);
    const id = randomUUID();
    const now = sessionClockNow();
    await db.execute(`
      INSERT INTO workshop_bays (id, workshop_id, code, label, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `, id, auth.workshop_id, code, label, now, now);
    response.status(201).json({ bay: { id, code, label, is_active: true } });
  } catch (error) { next(error); }
}));

app.delete('/api/workshop/bays/:id', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const result = await db.execute('DELETE FROM workshop_bays WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'Bay not found.');
    response.status(204).end();
  } catch (error) { next(error); }
}));

async function partsRecommendationContext(vehicleId: string, auth: AuthContext) {
  await requireDiagnosisVehicleAccess(vehicleId, auth);
  const vehicle = await db.first(`
    SELECT id, customer_id, workshop_id, make, model, catalogue_model_id
    FROM vehicles WHERE id = ? AND workshop_id = ?
  `, vehicleId, auth.workshop_id) as {
    id: string; customer_id: string; workshop_id: string; make: string; model: string; catalogue_model_id: string | null;
  } | undefined;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
  const diagnosis = await db.first(`
    SELECT id, predicted_fault, confirmed_fault, review_status, affected_component
    FROM ai_diagnoses
    WHERE vehicle_id = ? AND workshop_id = ? AND review_status IN ('confirmed', 'corrected')
    ORDER BY created_at DESC LIMIT 1
  `, vehicleId, auth.workshop_id) as {
    id: string; predicted_fault: string; confirmed_fault: string | null; review_status: string; affected_component: string | null;
  } | undefined;
  return { vehicle, diagnosis };
}

app.post('/api/intelligence/parts/recommend', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const vehicleId = requiredText(body.vehicle_id, 'Vehicle', 1, 36);
    const jobId = queryText(body.job_id) || null;
    const { vehicle, diagnosis } = await partsRecommendationContext(vehicleId, auth);
    const catalogueModelId = vehicle.catalogue_model_id ?? null;
    const componentKey = diagnosis?.affected_component ?? null;
    const faultName = diagnosis?.confirmed_fault ?? diagnosis?.predicted_fault ?? '';

    let relevant = await db.query(`
      SELECT p.id, p.sku, p.name, p.category, p.quantity, p.reorder_level, p.selling_price_cents,
             pc.component_key, pc.source AS compatibility_source
      FROM part_compatibility pc
      JOIN parts p ON p.id = pc.part_id AND p.workshop_id = ?
      WHERE pc.catalogue_model_id = ? AND (? IS NULL OR pc.component_key = ?)
    `, auth.workshop_id, catalogueModelId, componentKey, componentKey) as Record<string, unknown>[];
    if (relevant.length === 0 && componentKey) {
      relevant = await db.query(`
        SELECT id, sku, name, category, quantity, reorder_level, selling_price_cents,
               NULL AS component_key, 'component_keyword' AS compatibility_source
        FROM parts WHERE workshop_id = ? AND LOWER(category) = LOWER(?)
      `, auth.workshop_id, componentKey) as Record<string, unknown>[];
    }

    const recommendations = [];
    for (const part of relevant) {
      const inStock = Number(part.quantity) > 0;
      const score = Number((0.55 + (inStock ? 0.3 : 0) + (Number(part.quantity) > Number(part.reorder_level) ? 0.15 : 0)).toFixed(3));
      const reason = {
        fault: faultName || 'No confirmed diagnosis',
        component_key: componentKey,
        compatibility_source: part.compatibility_source,
        stock: Number(part.quantity),
        advisory_only: true,
      };
      const id = randomUUID();
      await db.execute(`
        INSERT INTO part_recommendations (
          id, workshop_id, vehicle_id, job_id, diagnosis_id, part_id, score, reason_json,
          status, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'advisory', ?, ?)
      `, id, auth.workshop_id, vehicleId, jobId, diagnosis?.id ?? null,
        String(part.id), score, JSON.stringify(reason), auth.id, sessionClockNow());
      recommendations.push({ id, part_id: part.id, sku: part.sku, name: part.name, score, reason });
    }
    response.status(201).json({ recommendations });
  } catch (error) { next(error); }
}));

app.get('/api/intelligence/vehicles/:vehicleId/parts', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const rows = await db.query(`
      SELECT r.id, r.score, r.status, r.feedback, r.reason_json, r.created_at,
             p.id AS part_id, p.sku, p.name, p.category, p.quantity, p.selling_price_cents
      FROM part_recommendations r
      JOIN parts p ON p.id = r.part_id AND p.workshop_id = r.workshop_id
      WHERE r.workshop_id = ? AND r.vehicle_id = ?
      ORDER BY r.score DESC, r.created_at DESC LIMIT 25
    `, auth.workshop_id, request.params.vehicleId);
    response.json({ recommendations: rows });
  } catch (error) { next(error); }
}));

app.post('/api/intelligence/parts/recommendations/:id/feedback', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const feedback = requiredText(body.feedback, 'Feedback', 1, 32);
    if (!['accepted', 'rejected', 'used', 'not_used'].includes(feedback)) throw new HttpError(400, 'Unsupported feedback value.');
    const result = await db.execute(`
      UPDATE part_recommendations SET feedback = ? WHERE id = ? AND workshop_id = ?
    `, feedback, request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'Recommendation not found.');
    response.json({ updated: true });
  } catch (error) { next(error); }
}));

async function requireTwinConsent(vehicleId: string, auth: AuthContext): Promise<void> {
  const consent = await db.first(`
    SELECT is_granted FROM vehicle_data_consents
    WHERE vehicle_id = ? AND workshop_id = ? AND scope = 'telemetry'
  `, vehicleId, auth.workshop_id) as { is_granted: number } | undefined;
  if (!consent || consent.is_granted !== 1) {
    throw new HttpError(403, 'Telemetry consent has not been recorded for this vehicle.');
  }
}

app.get('/api/twin/vehicles/:vehicleId/consent', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const consent = await db.first(`
      SELECT id, scope, is_granted, granted_at, revoked_at, recorded_by_name
      FROM vehicle_data_consents WHERE vehicle_id = ? AND workshop_id = ? AND scope = 'telemetry'
    `, request.params.vehicleId, auth.workshop_id);
    response.json({ consent: consent ?? null });
  } catch (error) { next(error); }
}));

app.post('/api/twin/vehicles/:vehicleId/consent', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const body = requireObject(request.body);
    const isGranted = body.is_granted === true;
    const id = randomUUID();
    const now = sessionClockNow();
    await db.execute(`
      INSERT INTO vehicle_data_consents (
        id, workshop_id, vehicle_id, customer_id, scope, is_granted,
        granted_at, revoked_at, recorded_by_user_id, recorded_by_name, created_at
      ) VALUES (?, ?, ?, ?, 'telemetry', ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_granted = VALUES(is_granted), granted_at = VALUES(granted_at),
        revoked_at = VALUES(revoked_at), recorded_by_user_id = VALUES(recorded_by_user_id),
        recorded_by_name = VALUES(recorded_by_name)
    `, id, auth.workshop_id, request.params.vehicleId,
      (await db.first('SELECT customer_id FROM vehicles WHERE id = ? AND workshop_id = ?', request.params.vehicleId, auth.workshop_id) as { customer_id: string }).customer_id,
      isGranted ? 1 : 0, isGranted ? now : null, isGranted ? null : now, auth.id, auth.name, now);
    response.json({ consent: { vehicle_id: request.params.vehicleId, scope: 'telemetry', is_granted: isGranted } });
  } catch (error) { next(error); }
}));

app.post('/api/twin/telemetry', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const vehicleId = requiredText(body.vehicle_id, 'Vehicle', 1, 36);
    await requireDiagnosisVehicleAccess(vehicleId, auth);
    await requireTwinConsent(vehicleId, auth);
    const source = requiredText(body.source, 'Source', 1, 80);
    const signals = body.signals;
    if (!Array.isArray(signals) || signals.length === 0 || signals.length > 200) {
      throw new HttpError(400, 'Signals must be an array with 1 to 200 entries.');
    }
    const receivedAt = sessionClockNow();
    let lastSignalAt = receivedAt;
    const state: Record<string, unknown> = {};
    for (const item of signals) {
      const signal = requireObject(item);
      const key = requiredText(signal.signal_key, 'Signal key', 1, 120);
      const value = signal.value;
      if (value === undefined || typeof value === 'function') throw new HttpError(400, 'Each signal needs a value.');
      const observedAt = queryText(signal.observed_at) || receivedAt;
      if (Number.isNaN(new Date(observedAt).getTime())) throw new HttpError(400, 'Signal timestamps must be ISO-8601 values.');
      if (new Date(observedAt).getTime() > new Date(lastSignalAt).getTime()) lastSignalAt = observedAt;
      await db.execute(`
        INSERT INTO vehicle_telemetry_events (
          id, workshop_id, vehicle_id, source, signal_key, signal_value_json,
          observed_at, received_at, provenance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, randomUUID(), auth.workshop_id, vehicleId, source, key,
        JSON.stringify(value), observedAt, receivedAt, source);
      state[key] = value;
    }
    if (typeof state.odometer_km === 'number' || typeof state.odometer_km === 'string') {
      state.odometer_km = Number(state.odometer_km);
    }
    await db.execute(`
      INSERT INTO vehicle_twin_states (
        vehicle_id, workshop_id, odometer_km, state_json, source, last_signal_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        odometer_km = VALUES(odometer_km), state_json = VALUES(state_json),
        source = VALUES(source), last_signal_at = VALUES(last_signal_at), updated_at = VALUES(updated_at)
    `, vehicleId, auth.workshop_id,
      typeof state.odometer_km === 'number' ? state.odometer_km : null,
      JSON.stringify(state), source, lastSignalAt, receivedAt);
    response.status(202).json({ accepted: signals.length, last_signal_at: lastSignalAt });
  } catch (error) { next(error); }
}));

app.get('/api/twin/vehicles/:vehicleId/state', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const state = await db.first(`
      SELECT vehicle_id, odometer_km, state_json, source, last_signal_at, updated_at
      FROM vehicle_twin_states WHERE vehicle_id = ? AND workshop_id = ?
    `, request.params.vehicleId, auth.workshop_id);
    response.json({ state: state ? { ...state, state_json: JSON.parse(String(state.state_json)) } : null });
  } catch (error) { next(error); }
}));

app.get('/api/twin/vehicles/:vehicleId/history', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const limit = Math.min(Math.max(Number(request.query.limit ?? 100), 1), 500);
    const events = await db.query(`
      SELECT signal_key, signal_value_json, observed_at, source
      FROM vehicle_telemetry_events
      WHERE vehicle_id = ? AND workshop_id = ?
      ORDER BY observed_at DESC LIMIT ${Number.isFinite(limit) ? limit : 100}
    `, request.params.vehicleId, auth.workshop_id);
    response.json({ events });
  } catch (error) { next(error); }
}));

app.post('/api/twin/vin-decode', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const vin = requiredText(body.vin, 'VIN', 17, 17).toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, 'Enter a valid 17-character VIN.');
    const cached = await db.first('SELECT payload_json, provider, decoded_at FROM vehicle_vin_decodes WHERE vin = ?', vin);
    if (cached) {
      response.json({ decoded: JSON.parse(String(cached.payload_json)), provider: cached.provider, cached: true });
      return;
    }
    const providerUrl = process.env.NEXTGEN_VIN_PROVIDER_URL;
    if (!providerUrl) throw new HttpError(503, 'No VIN provider is configured. Set NEXTGEN_VIN_PROVIDER_URL.');
    const providerResponse = await fetch(`${providerUrl.replace(/\/$/, '')}/${encodeURIComponent(vin)}`, {
      headers: process.env.NEXTGEN_VIN_PROVIDER_KEY
        ? { Authorization: `Bearer ${process.env.NEXTGEN_VIN_PROVIDER_KEY}` }
        : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!providerResponse.ok) throw new HttpError(502, `VIN provider returned ${providerResponse.status}.`);
    const decoded = await providerResponse.json() as Record<string, unknown>;
    await db.execute(`
      INSERT INTO vehicle_vin_decodes (vin, payload_json, provider, decoded_at) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), decoded_at = VALUES(decoded_at)
    `, vin, JSON.stringify(decoded), new URL(providerUrl).host, sessionClockNow());
    response.json({ decoded, provider: new URL(providerUrl).host, cached: false });
  } catch (error) { next(error); }
}));

app.post('/api/visual/images', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const vehicleId = requiredText(body.vehicle_id, 'Vehicle', 1, 36);
    await requireDiagnosisVehicleAccess(vehicleId, auth);
    const imageUrl = requiredText(body.image_url, 'Image URL', 1, 1000);
    if (!/^(https?:\/\/|\/)/.test(imageUrl)) throw new HttpError(400, 'Image URL must be absolute HTTP(S) or a local path.');
    const id = randomUUID();
    await db.execute(`
      INSERT INTO vehicle_fault_images (
        id, workshop_id, vehicle_id, job_id, diagnosis_id, image_url, mime_type,
        source, captured_at, uploaded_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, auth.workshop_id, vehicleId, queryText(body.job_id) || null,
      queryText(body.diagnosis_id) || null, imageUrl, queryText(body.mime_type) || null,
      queryText(body.source) || 'manual_upload', queryText(body.captured_at) || null,
      auth.id, sessionClockNow());
    response.status(201).json({ image: { id, image_url: imageUrl } });
  } catch (error) { next(error); }
}));

app.get('/api/visual/vehicles/:vehicleId/images', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const images = await db.query(`
      SELECT id, image_url, mime_type, source, captured_at, created_at
      FROM vehicle_fault_images WHERE workshop_id = ? AND vehicle_id = ? ORDER BY created_at DESC LIMIT 100
    `, auth.workshop_id, request.params.vehicleId);
    response.json({ images });
  } catch (error) { next(error); }
}));

app.post('/api/visual/images/:id/annotations', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const componentKey = requiredText(body.component_key, 'Component', 1, 64);
    const bbox = body.bbox;
    if (!bbox || typeof bbox !== 'object' || Array.isArray(bbox)) throw new HttpError(400, 'A bounding box is required.');
    const image = await db.first('SELECT id FROM vehicle_fault_images WHERE id = ? AND workshop_id = ?', request.params.id, auth.workshop_id);
    if (!image) throw new HttpError(404, 'Image not found.');
    const id = randomUUID();
    await db.execute(`
      INSERT INTO vehicle_image_annotations (
        id, workshop_id, image_id, component_key, bbox_json, note, annotated_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, auth.workshop_id, request.params.id, componentKey, JSON.stringify(bbox),
      queryText(body.note) || null, auth.id, sessionClockNow());
    response.status(201).json({ annotation: { id, component_key: componentKey } });
  } catch (error) { next(error); }
}));

app.post('/api/visual/localize', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const vehicleId = requiredText(body.vehicle_id, 'Vehicle', 1, 36);
    await requireDiagnosisVehicleAccess(vehicleId, auth);
    const imageId = requiredText(body.image_id, 'Image', 1, 36);
    const image = await db.first(`
      SELECT id FROM vehicle_fault_images WHERE id = ? AND vehicle_id = ? AND workshop_id = ?
    `, imageId, vehicleId, auth.workshop_id);
    if (!image) throw new HttpError(404, 'Image not found for this vehicle.');
    const annotations = await db.query(`
      SELECT id, component_key, bbox_json FROM vehicle_image_annotations
      WHERE image_id = ? AND workshop_id = ? ORDER BY created_at DESC
    `, imageId, auth.workshop_id) as { id: string; component_key: string; bbox_json: string }[];
    if (annotations.length === 0) throw new HttpError(400, 'Annotate at least one component before localizing.');

    const localizations = [];
    for (const annotation of annotations) {
      const box = JSON.parse(annotation.bbox_json) as Record<string, unknown>;
      const x = Number(box.x ?? box.left ?? 0);
      const y = Number(box.y ?? box.top ?? 0);
      const width = Number(box.width ?? box.w ?? 0);
      const height = Number(box.height ?? box.h ?? 0);
      const projection = {
        normalized_center: [x + width / 2, y + height / 2],
        normalized_size: [width, height],
        component_key: annotation.component_key,
        basis: 'manual_annotation',
      };
      const id = randomUUID();
      await db.execute(`
        INSERT INTO vehicle_visual_localizations (
          id, workshop_id, vehicle_id, image_id, component_key, confidence,
          projection_json, provider, status, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'manual_annotation', 'proposed', ?)
      `, id, auth.workshop_id, vehicleId, imageId, annotation.component_key,
        JSON.stringify(projection), sessionClockNow());
      localizations.push({ id, component_key: annotation.component_key, projection });
    }
    response.status(201).json({ localizations });
  } catch (error) { next(error); }
}));

app.get('/api/visual/vehicles/:vehicleId/localizations', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    await requireDiagnosisVehicleAccess(request.params.vehicleId, auth);
    const rows = await db.query(`
      SELECT id, image_id, component_key, confidence, projection_json, provider, status, created_at
      FROM vehicle_visual_localizations
      WHERE workshop_id = ? AND vehicle_id = ? ORDER BY created_at DESC LIMIT 100
    `, auth.workshop_id, request.params.vehicleId);
    response.json({ localizations: rows });
  } catch (error) { next(error); }
}));

app.patch('/api/visual/localizations/:id/review', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const status = requiredText(body.status, 'Status', 1, 32);
    if (!['confirmed', 'rejected'].includes(status)) throw new HttpError(400, 'Status must be confirmed or rejected.');
    const result = await db.execute(`
      UPDATE vehicle_visual_localizations SET status = ?, reviewed_by_user_id = ?
      WHERE id = ? AND workshop_id = ?
    `, status, auth.id, request.params.id, auth.workshop_id);
    if (result.affectedRows === 0) throw new HttpError(404, 'Localization not found.');
    response.json({ updated: true });
  } catch (error) { next(error); }
}));

app.get('/api/smart-workshop/assets/:assetKey/validation', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const asset = await db.first('SELECT * FROM vehicle_3d_assets WHERE asset_key = ?', request.params.assetKey);
    if (!asset) throw new HttpError(404, '3D asset not found.');
    const descriptor = describeAsset(asset as Record<string, unknown>);
    const nodeMaps = await db.query(`
      SELECT id, component_key, node_name, geometry_source, confidence,
             verification_status, verified_by_name
      FROM vehicle_component_node_maps WHERE asset_key = ?
    `, request.params.assetKey);
    const verified = nodeMaps.filter((row) => (row as { verification_status: string }).verification_status === 'verified').length;
    response.json({
      asset: descriptor,
      node_maps: nodeMaps,
      integrity: {
        has_license: Boolean(descriptor.license),
        has_source: Boolean(descriptor.source),
        exact_match_claim: descriptor.is_exact_match,
        verified_node_maps: verified,
        total_node_maps: nodeMaps.length,
        file_exists: descriptor.file_exists,
      },
    });
  } catch (error) { next(error); }
}));

app.get('/api/smart-workshop/assets/:assetKey/node-maps', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const rows = await db.query(`
      SELECT id, component_key, node_name, geometry_source, confidence,
             verification_status, verified_by_name, notes
      FROM vehicle_component_node_maps WHERE asset_key = ? ORDER BY component_key, node_name
    `, request.params.assetKey);
    response.json({ node_maps: rows });
  } catch (error) { next(error); }
}));

app.post('/api/smart-workshop/assets/:assetKey/node-maps', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const body = requireObject(request.body);
    const componentKey = requiredText(body.component_key, 'Component', 1, 64);
    const nodeName = requiredText(body.node_name, 'Node name', 1, 191);
    const geometrySource = queryText(body.geometry_source) || 'exact';
    if (!['exact', 'representative', 'procedural'].includes(geometrySource)) throw new HttpError(400, 'Unsupported geometry source.');
    const id = randomUUID();
    await db.execute(`
      INSERT INTO vehicle_component_node_maps (
        id, asset_key, component_key, node_name, geometry_source, confidence,
        verification_status, verified_by_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', NULL, ?, ?)
    `, id, request.params.assetKey, componentKey, nodeName, geometrySource,
      body.confidence === undefined ? null : Number(body.confidence),
      queryText(body.notes) || null, sessionClockNow());
    response.status(201).json({ node_map: { id, verification_status: 'proposed' } });
  } catch (error) { next(error); }
}));

app.patch('/api/smart-workshop/node-maps/:id/verify', requireAuth, asyncRoute(async (request, response, next) => {
  try {
    const auth = response.locals.auth as AuthContext;
    requireIntelligenceStaff(auth);
    const result = await db.execute(`
      UPDATE vehicle_component_node_maps
      SET verification_status = 'verified', verified_by_name = ?
      WHERE id = ?
    `, auth.name, request.params.id);
    if (result.affectedRows === 0) throw new HttpError(404, 'Node map not found.');
    response.json({ updated: true });
  } catch (error) { next(error); }
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

const vite = IS_PRODUCTION
  ? undefined
  : await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

if (vite) {
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(process.cwd(), 'dist')));
}

app.get('*', asyncRoute(async (request, response, next) => {
  if (IS_PRODUCTION) {
    response.sendFile(resolve(process.cwd(), 'dist', 'index.html'), (error) => {
      if (error) next(error);
    });
    return;
  }

  try {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    void vite!.transformIndexHtml(request.originalUrl, html)
      .then((transformed) => response.status(200).set({ 'Content-Type': 'text/html' }).send(transformed))
      .catch(next);
  } catch (error) {
    next(error);
  }
}));

app.use((error: unknown, _request: express.Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'ER_DUP_ENTRY') {
    if (message.includes('users.email') || message.includes('users_email_uq')) {
      response.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }
    response.status(409).json({ error: 'That value conflicts with an existing record.' });
    return;
  }
  console.error('Request failed:', {
    name: error instanceof Error ? error.name : 'UnknownError',
    code,
  });
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`NEXTGEN ${IS_PRODUCTION ? 'server' : 'development server'} listening on port ${port}`);
});

function closeServer(): void {
  server.close(() => {
    void Promise.resolve(vite?.close()).finally(() => db.close());
  });
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
