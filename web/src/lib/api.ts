// Thin fetch helpers for the API (proxied under /api by Vite in development).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

const WHO_KEY = 'review.who';

export function getWho(): string {
  try {
    return localStorage.getItem(WHO_KEY) || '';
  } catch {
    return '';
  }
}

export function setWho(name: string): void {
  try {
    localStorage.setItem(WHO_KEY, name);
  } catch {
    // storage may be unavailable (private mode); the name is then asked again
  }
}
