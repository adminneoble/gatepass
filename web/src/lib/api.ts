export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? 'Something went wrong. Please try again.', data.code);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T = { ok: true }>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = { ok: true }>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T = { ok: true }>(p: string) => request<T>('DELETE', p),
};
