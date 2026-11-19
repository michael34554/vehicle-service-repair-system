const CSRF_COOKIE = 'nextgen_csrf';

function readCsrfCookie(): string | null {
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice(CSRF_COOKIE.length + 1));
  } catch {
    return null;
  }
}

export async function initializeCsrfToken(): Promise<void> {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not initialize request protection (${response.status}).`);
  const result = await response.json() as { csrfToken?: unknown };
  if (typeof result.csrfToken !== 'string' || readCsrfCookie() !== result.csrfToken) {
    throw new Error('The request protection token could not be verified.');
  }
}

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

async function sendRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (!isSafeMethod(method)) {
    const csrfToken = readCsrfCookie();
    if (!csrfToken) throw new Error('Request protection is missing. Refresh the page and try again.');
    headers.set('X-CSRF-TOKEN', csrfToken);
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

async function refreshSession(): Promise<boolean> {
  const csrfToken = readCsrfCookie();
  if (!csrfToken) return false;
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': csrfToken },
      credentials: 'same-origin',
    });
    return response.ok;
  } catch (error) {
    console.error('Unable to refresh the NEXTGEN session:', error);
    return false;
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  retryUnauthorized = true
): Promise<Response> {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const isAuthOperation = requestUrl.startsWith('/api/auth/') &&
    !requestUrl.startsWith('/api/auth/me');
  let response = await sendRequest(input, init);

  if (response.status === 401 && retryUnauthorized && !isAuthOperation && await refreshSession()) {
    response = await sendRequest(input, init);
  }

  if (response.status === 401 && !isAuthOperation) {
    window.dispatchEvent(new CustomEvent('nextgen:session-expired'));
  }
  return response;
}
