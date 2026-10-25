import { RuleError } from '@sk/rules';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: ContentfulStatusCode, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);

const RULE_STATUS: Record<string, ContentfulStatusCode> = {
  not_found: 404,
  busy: 409,
  conflict: 409,
};

export function toHttpError(e: unknown): HttpError | null {
  if (e instanceof HttpError) return e;
  if (e instanceof RuleError) return new HttpError(RULE_STATUS[e.code] ?? 422, e.code, e.message);
  if (e instanceof ZodError)
    return new HttpError(
      400,
      'bad_request',
      'Invalid request',
      e.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  return null;
}
