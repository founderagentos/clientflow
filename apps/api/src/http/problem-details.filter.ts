import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { ZodError } from 'zod';
import {
  isAppError,
  InternalError,
  ValidationError,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from '@agentos/result-errors';

function zodToFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
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
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const title =
        typeof response === 'string'
          ? response
          : String((response as { message?: unknown }).message ?? exception.message);
      return { type: `urn:agentos:problem:http_${status}`, title, status, code: `http_${status}`, instance };
    }
    return new InternalError().toProblemDetails(instance);
  }
}
