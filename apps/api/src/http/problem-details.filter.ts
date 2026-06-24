import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { ZodError } from 'zod';
import {
  isAppError,
  AppError,
  BadRequestError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  problemType,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from '@agentos/result-errors';

/** Canonical problem code per HTTP status, for framework errors that arrive without one. */
const CANONICAL_CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_failed',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

function zodToFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Map Fastify framework errors (body parsing / content-type / routing — thrown before our handlers
 * run, so they never become AppErrors) onto the proper problem type instead of a generic
 * http_<status> fallback. Fastify errors expose a string `code` and numeric `statusCode`.
 */
function fastifyErrorToAppError(exception: unknown): AppError | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const status = (exception as { statusCode?: unknown }).statusCode;
  const code = (exception as { code?: unknown }).code;
  if (typeof code === 'string' && code.startsWith('FST_ERR')) {
    if (status === 413) return new PayloadTooLargeError();
    if (status === 415) return new UnsupportedMediaTypeError();
    if (status === 400) return new BadRequestError('Malformed request body');
    if (status === 404) return new NotFoundError();
  }
  return undefined;
}

/**
 * Renders every error as RFC 9457 application/problem+json (CLAUDE.md §2/§3.9). Unexpected
 * (5xx) errors are logged via the structured Pino logger; never leak internals to clients.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const problem = this.toProblem(exception, request.url);

    if (problem.status >= 500) {
      this.logger.error({ err: exception, instance: problem.instance }, 'Unhandled error');
    }

    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (isAppError(exception)) {
      return exception.toProblemDetails(instance);
    }
    if (exception instanceof ZodError) {
      return new ValidationError('Validation failed', zodToFieldErrors(exception)).toProblemDetails(
        instance,
      );
    }
    const fastifyError = fastifyErrorToAppError(exception);
    if (fastifyError) {
      return fastifyError.toProblemDetails(instance);
    }
    if (exception instanceof HttpException) {
      // Nest wraps framework errors (e.g. Fastify's body-too-large) as HttpExceptions; map known
      // statuses onto the stable taxonomy so they carry a real code, not a generic http_<status>.
      const status = exception.getStatus();
      const response = exception.getResponse();
      const title =
        typeof response === 'string'
          ? response
          : String((response as { message?: unknown }).message ?? exception.message);
      const code = CANONICAL_CODE_BY_STATUS[status] ?? `http_${status}`;
      return { type: problemType(code), title, status, code, instance };
    }
    return new InternalError().toProblemDetails(instance);
  }
}
