/* AGPL-3.0-or-later */
export type CfCreds = { accountId: string; token: string };

export const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export class CfApiError extends Error {
  status: number;
  errors: unknown;
  constructor(status: number, errors: unknown, message: string) {
    super(message);
    this.name = "CfApiError";
    this.status = status;
    this.errors = errors;
  }
}

export function cfFetch(creds: CfCreds, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${CF_API_BASE}/accounts/${creds.accountId}${path}`, { ...init, headers });
}

export async function cfJson<T>(creds: CfCreds, path: string, init?: RequestInit): Promise<T> {
  const res = await cfFetch(creds, path, init);
  const body = (await res.json()) as { success?: boolean; result?: T; errors?: unknown };
  if (!res.ok || body.success === false) {
    throw new CfApiError(res.status, body.errors, `Cloudflare API error (${res.status})`);
  }
  return body.result as T;
}
