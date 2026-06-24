import type { ZodType } from 'zod';

/** HTTP methods the API exposes (lowercase to match OpenAPI path-item keys). */
export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** How a route is authenticated, mapped to an OpenAPI security requirement. */
export type RouteSecurity = 'bearer' | 'apiKey' | 'none';

/** The success response a route returns. */
export interface RouteResponse {
  status: number;
  description?: string;
  /** Zod schema of the response body, converted to JSON Schema for the doc. */
  schema?: ZodType;
}

/**
 * Declarative description of one HTTP route, reusing the route's existing Zod DTOs. Each module /
 * controller area exports an array of these; the host assembles them into the OpenAPI 3.1 document
 * and a coverage test asserts they match the live routes (CLAUDE.md §6). Lives in `contracts` so both
 * the app and bounded-context modules can declare descriptors without crossing module boundaries.
 */
export interface RouteDescriptor {
  method: HttpMethod;
  /** Nest-style path including the global prefix, e.g. '/api/v1/roles/:id'. */
  path: string;
  summary: string;
  tags: string[];
  /** Defaults to 'bearer' when omitted. */
  security?: RouteSecurity;
  /** The `resource.action` permission the route requires, for documentation. */
  permission?: string;
  /** Zod schema for path parameters. */
  params?: ZodType;
  /** Zod schema for the query string. */
  query?: ZodType;
  /** Zod schema for the request body. */
  body?: ZodType;
  response: RouteResponse;
  /** Problem codes this route may return in addition to the global set (CLAUDE.md §6 taxonomy). */
  problems?: string[];
}
