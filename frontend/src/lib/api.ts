/**
 * Thin fetch wrapper that injects the bearer JWT, parses JSON, and surfaces
 * structured errors via the `ApiError` class.
 *
 * The frontend talks to the FastAPI backend at `/api/...` (Vite dev proxies in
 * dev; Caddy reverse-proxies in production), so the base URL is fixed.
 */

const TOKEN_KEY = "resonance.auth.token";

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export const tokenStorage = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, unknown>;
  raw?: boolean;
}

const API_BASE = "/api";

/** Parse FastAPI-style JSON error body: `{ detail: string | ValidationError[] }` or plain text. */
export function messageFromApiPayload(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload && typeof payload === "object" && "detail" in payload) {
    const d = (payload as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length > 0) {
      const item = d[0];
      if (item && typeof item === "object" && "msg" in item) {
        return String((item as { msg: unknown }).msg);
      }
    }
  }
  return fallback;
}

async function readResponseBodyAsUnknown(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, query, raw, headers, ...rest } = options;

  const url = new URL(API_BASE + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const finalHeaders = new Headers(headers as HeadersInit | undefined);
  const token = tokenStorage.get();
  if (token) finalHeaders.set("Authorization", `Bearer ${token}`);

  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }

  const response = await fetch(url.toString().replace(window.location.origin, ""), {
    ...rest,
    headers: finalHeaders,
    body: payload,
  });

  if (response.status === 401) {
    let payload: unknown;
    try {
      payload = await readResponseBodyAsUnknown(response);
    } catch {
      payload = undefined;
    }
    const message = messageFromApiPayload(payload ?? null, "Unauthorized");
    tokenStorage.clear();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError(message, 401, payload);
  }

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      detail = await readResponseBodyAsUnknown(response);
    } catch {
      // keep statusText
    }
    const message = messageFromApiPayload(detail, String(response.statusText));
    throw new ApiError(message, response.status, detail);
  }

  if (raw || response.status === 204) {
    return (undefined as unknown) as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return ((await response.text()) as unknown) as T;
}

export const api = {
  get: <T>(path: string, opts?: ApiFetchOptions) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T = void>(path: string, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "DELETE" }),
};
