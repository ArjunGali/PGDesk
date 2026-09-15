import { Preferences } from '@capacitor/preferences';

/**
 * The API base URL.
 *
 * On device the app talks to whatever server the owner configured — their own
 * machine on the LAN, or a hosted one. It is stored rather than compiled in so
 * a single APK works for any deployment.
 */
const BASE_URL_KEY = 'pgm.apiBaseUrl';
const ACCESS_TOKEN_KEY = 'pgm.accessToken';
const REFRESH_TOKEN_KEY = 'pgm.refreshToken';

const DEFAULT_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (typeof window !== 'undefined' && window.location.origin.startsWith('http')
    ? `${window.location.origin.replace(/:\d+$/, ':3000')}/api`
    : 'http://10.0.2.2:3000/api');

let cachedBaseUrl: string | null = null;
let cachedAccessToken: string | null = null;
let cachedRefreshToken: string | null = null;

/** In-flight refresh, so a burst of 401s triggers one refresh, not many. */
let refreshInFlight: Promise<boolean> | null = null;

/** Called when the session cannot be recovered, so the UI can show sign-in. */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the server could not be reached at all. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

async function store(key: string, value: string | null): Promise<void> {
  if (value === null) await Preferences.remove({ key });
  else await Preferences.set({ key, value });
}

async function read(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value;
}

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  cachedBaseUrl = (await read(BASE_URL_KEY)) ?? DEFAULT_BASE_URL;
  return cachedBaseUrl;
}

export async function setBaseUrl(url: string): Promise<void> {
  const normalised = url.trim().replace(/\/+$/, '');
  cachedBaseUrl = normalised.endsWith('/api') ? normalised : `${normalised}/api`;
  await store(BASE_URL_KEY, cachedBaseUrl);
}

export async function loadTokens(): Promise<{ access: string | null }> {
  cachedAccessToken = await read(ACCESS_TOKEN_KEY);
  cachedRefreshToken = await read(REFRESH_TOKEN_KEY);
  return { access: cachedAccessToken };
}

export async function saveTokens(
  access: string | null,
  refresh: string | null,
): Promise<void> {
  cachedAccessToken = access;
  cachedRefreshToken = refresh;
  await store(ACCESS_TOKEN_KEY, access);
  await store(REFRESH_TOKEN_KEY, refresh);
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Internal: prevents a refresh loop. */
  skipRefresh?: boolean;
  signal?: AbortSignal;
}

function buildUrl(
  base: string,
  path: string,
  query?: RequestOptions['query'],
): string {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function refreshSession(): Promise<boolean> {
  if (!cachedRefreshToken) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const base = await getBaseUrl();
      const response = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cachedRefreshToken }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      await saveTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const base = await getBaseUrl();
  const url = buildUrl(base, path, options.query);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cachedAccessToken) headers.Authorization = `Bearer ${cachedAccessToken}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(
      'Cannot reach the server. Check the connection and the server address in Settings.',
      0,
    );
  }

  // A 401 from an authentication attempt is a wrong PIN, not an expired
  // session: refreshing would be pointless and bouncing the user back to the
  // profile list would hide the message telling them what went wrong.
  if (response.status === 401 && !isAuthAttempt(path) && !options.skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    await saveTokens(null, null);
    onUnauthenticated?.();
    throw new ApiError('Your session has ended. Please choose your profile again.', 401);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(extractMessage(data, response.status), response.status, data);
  }
  return data as T;
}

/**
 * Endpoints that establish a session rather than consume one. Their failures
 * belong to the screen that called them.
 */
function isAuthAttempt(path: string): boolean {
  return (
    path.startsWith('/auth/unlock') ||
    path.startsWith('/auth/set-pin') ||
    path.startsWith('/auth/refresh') ||
    path.startsWith('/auth/change-pin')
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (Array.isArray(message)) return message.join('\n');
    if (typeof message === 'string') return message;
  }
  if (status >= 500) return 'The server ran into a problem. Please try again.';
  return 'Something went wrong.';
}

export const api = {
  get: <T,>(path: string, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { query }),
  post: <T,>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T,>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: 'DELETE', body }),
};

/**
 * Fetches a PDF, spreadsheet or document as a blob.
 *
 * The token goes in the Authorization header, never in the URL: URLs end up in
 * logs, history and share sheets, and an access token there would leak.
 */
export async function fetchBlob(
  path: string,
  query?: RequestOptions['query'],
): Promise<{ blob: Blob; fileName: string }> {
  const base = await getBaseUrl();
  const url = buildUrl(base, path, query);

  const send = async (): Promise<Response> =>
    fetch(url, {
      headers: cachedAccessToken
        ? { Authorization: `Bearer ${cachedAccessToken}` }
        : {},
    });

  let response: Response;
  try {
    response = await send();
    if (response.status === 401 && (await refreshSession())) {
      response = await send();
    }
  } catch {
    throw new ApiError('Cannot reach the server.', 0);
  }

  if (!response.ok) {
    throw new ApiError(
      response.status === 401
        ? 'Your session has ended. Please choose your profile again.'
        : 'That file could not be produced.',
      response.status,
    );
  }

  return {
    blob: await response.blob(),
    fileName: fileNameFrom(response.headers.get('Content-Disposition')) ?? 'download',
  };
}

function fileNameFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}
