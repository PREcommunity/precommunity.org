import { unstable_rethrow } from 'next/navigation';

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type NestErrorBody = { message?: string | string[] };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

function responseMessage(body: string, fallback: string) {
  if (!body.trim()) return fallback;
  try {
    const parsed = JSON.parse(body) as NestErrorBody;
    if (Array.isArray(parsed.message)) return parsed.message.join(' · ');
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
  } catch {
    // Non-JSON error responses use the caller's stable fallback.
  }
  return fallback;
}

async function checkedResponse(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  label: string,
) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    unstable_rethrow(cause);
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(`${label} could not be reached`, 0, { cause });
  }

  if (!response.ok) {
    const fallback = `${label} returned ${response.status}`;
    throw new ApiError(responseMessage(await response.text(), fallback), response.status);
  }
  return response;
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  label = 'API',
): Promise<T> {
  const response = await checkedResponse(input, init, label);
  const body = await response.text();
  if (!body.trim()) throw new ApiError(`${label} returned an empty response`, response.status);
  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    throw new ApiError(`${label} returned invalid JSON`, response.status, { cause });
  }
}

export async function requestOk(
  input: RequestInfo | URL,
  init?: RequestInit,
  label = 'API',
): Promise<void> {
  await checkedResponse(input, init, label);
}

function clientRequest(path: string, init?: RequestInit): [string, RequestInit] {
  return [`${apiUrl}${path}`, { ...init, credentials: init?.credentials ?? 'include' }];
}

export function clientApiJson<T>(path: string, init?: RequestInit, label = 'API') {
  const [url, requestInit] = clientRequest(path, init);
  return requestJson<T>(url, requestInit, label);
}

export function clientApiRequest(path: string, init?: RequestInit, label = 'API') {
  const [url, requestInit] = clientRequest(path, init);
  return requestOk(url, requestInit, label);
}
