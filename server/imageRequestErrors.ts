export class ImageRequestError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly upstreamStatus?: number, public readonly haltFallback = false) {
    super(message); this.name = "ImageRequestError";
  }
}

export class ImageResultSaveError extends ImageRequestError {
  constructor(cause: unknown) {
    super("图片已返回，但本地保存失败，请检查存储后确认任务结果", false, undefined, true);
    this.name = "ImageResultSaveError";
    this.cause = cause;
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
