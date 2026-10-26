import { apiUrl } from "@/src/lib/api/origin";
import { getInjectedDesktopConfig, localAuthHeaderName } from "@/src/lib/runtime/config";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function readError(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (body.error) return { message: body.error, code: body.code };
  } catch {
    // Ignore non-JSON error bodies.
  }
  if (response.status === 401) return { message: "unauthorized" };
  if (response.status === 502 || response.status === 503) {
    return { message: "unable to connect to server" };
  }
  if (response.status === 403) return { message: "permission denied" };
  if (response.status === 404) return { message: "file not found" };
  return { message: "request failed" };
}

const REQUEST_TIMEOUT_MS = 5000;

type RequestOptions = RequestInit & { timeoutMs?: number };

export async function apiRequest<T>(path: string, init?: RequestOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");

  const token = getInjectedDesktopConfig()?.localAuthToken?.trim();
  if (token && !headers.has(localAuthHeaderName())) {
    headers.set(localAuthHeaderName(), token);
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    init.signal.addEventListener("abort", onParentAbort);
  }

  const timeoutMs = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchInit = { ...(init ?? {}) };
  delete (fetchInit as { timeoutMs?: number }).timeoutMs;
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...fetchInit,
      cache: "no-store",
      credentials: "omit",
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const aborted =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    throw new ApiError(aborted ? "unable to connect to server" : "network disconnected", 0);
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", onParentAbort);
  }

  if (!response.ok) {
    const error = await readError(response);
    throw new ApiError(error.message, response.status, error.code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Authenticated binary response, used for private server icons. */
export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  const token = getInjectedDesktopConfig()?.localAuthToken?.trim();
  if (token) headers.set(localAuthHeaderName(), token);
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    credentials: "omit",
    headers,
  });
  if (!response.ok) {
    const error = await readError(response);
    throw new ApiError(error.message, response.status, error.code);
  }
  return response.blob();
}
