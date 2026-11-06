export class ImageRequestError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly upstreamStatus?: number, public readonly haltFallback = false) {
    super(message); this.name = "ImageRequestError";
  }
}

export function canRetryImageRequest(error: unknown) {
  return !(error instanceof ImageRequestError && !error.retryable);
}

export function imageRequestErrors(messages: string[], failures: unknown[], fallback: string) {
  return new ImageRequestError(messages.join("; ") || fallback, failures.length === 0 || failures.some(canRetryImageRequest), undefined,
    failures.some(error => error instanceof ImageRequestError && error.haltFallback));
}

export function canRetryImageStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status !== 501);
}
