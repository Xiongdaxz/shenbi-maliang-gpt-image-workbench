export type LimitedRequestBodyErrorCode = "body_too_large" | "invalid_content_length";

export class LimitedRequestBodyError extends Error {
  constructor(readonly code: LimitedRequestBodyErrorCode) {
    super(code);
    this.name = "LimitedRequestBodyError";
  }
}

function declaredRequestBodySize(request: Request) {
  const value = String(request.headers.get("content-length") ?? "").trim();
  if (!value) return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new LimitedRequestBodyError("invalid_content_length");
  return size;
}

export async function requestWithLimitedBody(request: Request, maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("maximumBytes must be a non-negative safe integer");
  }
  const declaredSize = declaredRequestBodySize(request);
  if (declaredSize !== null && declaredSize > maximumBytes) {
    throw new LimitedRequestBodyError("body_too_large");
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LimitedRequestBodyError("body_too_large");
    }
    chunks.push(value);
  }

  const headers = new Headers(request.headers);
  headers.set("Content-Length", String(size));
  const body = size > 0
    ? new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    : undefined;
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal
  });
}
