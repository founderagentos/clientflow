import type { RouteDescriptor } from '@agentos/contracts';
import { PROBLEM_CATALOG } from '@agentos/result-errors';
import { pathParamNames, toOpenApiPath, zodToJsonSchema } from './zod-schema';

/** Minimal structural typing for the document we emit (kept loose — it is JSON, not a domain model). */
type Json = Record<string, unknown>;

const MUTATING = new Set(['post', 'patch', 'put', 'delete']);

/** Distinct HTTP statuses present in the problem taxonomy, each gets a shared response component. */
const PROBLEM_STATUSES = [...new Set(PROBLEM_CATALOG.map((p) => p.status))].sort((a, b) => a - b);

function problemRef(status: number): Json {
  return { $ref: `#/components/responses/Problem${status}` };
}

function securityRequirement(security: RouteDescriptor['security']): Json[] {
  switch (security ?? 'bearer') {
    case 'none':
      return [];
    case 'apiKey':
      return [{ apiKeyAuth: [] }, { bearerAuth: [] }];
    case 'bearer':
    default:
      return [{ bearerAuth: [] }];
  }
}

/** The set of problem statuses an operation may return, given its shape. */
function problemStatusesFor(route: RouteDescriptor): number[] {
  const statuses = new Set<number>([429, 500]); // rate limiting + unexpected failure are universal
  const secured = (route.security ?? 'bearer') !== 'none' || route.permission !== undefined;
  if (secured) {
    statuses.add(401);
    statuses.add(403);
  }
  if (route.body || route.query || route.params) {
    statuses.add(400);
    statuses.add(422);
  }
  if (route.body) {
    statuses.add(413);
  }
  if (pathParamNames(route.path).length > 0) {
    statuses.add(404);
  }
  if (MUTATING.has(route.method)) {
    statuses.add(409);
  }
  for (const code of route.problems ?? []) {
    const entry = PROBLEM_CATALOG.find((p) => p.code === code);
    if (entry) {
      statuses.add(entry.status);
    }
  }
  return [...statuses].sort((a, b) => a - b);
}

function parametersFor(route: RouteDescriptor): Json[] {
  const params: Json[] = [];
  // Path parameters — typed from `params` schema properties when available, else string.
  const paramSchema = route.params ? zodToJsonSchema(route.params, 'input') : undefined;
  const paramProps = (paramSchema?.properties as Json | undefined) ?? {};
  for (const name of pathParamNames(route.path)) {
    params.push({
      name,
      in: 'path',
      required: true,
      schema: paramProps[name] ?? { type: 'string' },
    });
  }
  // Query parameters — one per property of the query schema.
  if (route.query) {
    const q = zodToJsonSchema(route.query, 'input');
    const props = (q.properties as Json | undefined) ?? {};
    const required = new Set((q.required as string[] | undefined) ?? []);
    for (const [name, schema] of Object.entries(props)) {
      params.push({ name, in: 'query', required: required.has(name), schema });
    }
  }
  // Idempotency-Key is accepted on every mutating request.
  if (MUTATING.has(route.method)) {
    params.push({ $ref: '#/components/parameters/IdempotencyKey' });
  }
  params.push({ $ref: '#/components/parameters/CorrelationId' });
  return params;
}

function operationFor(route: RouteDescriptor): Json {
  const responses: Json = {};
  const successBody = route.response.schema
    ? { content: { 'application/json': { schema: zodToJsonSchema(route.response.schema, 'output') } } }
    : {};
  responses[String(route.response.status)] = {
    description: route.response.description ?? 'Success',
    ...successBody,
  };
  for (const status of problemStatusesFor(route)) {
    responses[String(status)] = problemRef(status);
  }

  const op: Json = {
    operationId: `${route.method}_${route.path}`.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/g, ''),
    summary: route.summary,
    tags: route.tags,
    security: securityRequirement(route.security),
    responses,
  };
  if (route.permission) {
    op['x-required-permission'] = route.permission;
  }
  const parameters = parametersFor(route);
  if (parameters.length > 0) {
    op.parameters = parameters;
  }
  if (route.body) {
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: zodToJsonSchema(route.body, 'input') } },
    };
  }
  return op;
}

function problemResponses(): Json {
  const out: Json = {};
  for (const status of PROBLEM_STATUSES) {
    const codes = PROBLEM_CATALOG.filter((p) => p.status === status).map((p) => p.code);
    out[`Problem${status}`] = {
      description: `Problem (${codes.join(', ')})`,
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
      },
    };
  }
  return out;
}

const PROBLEM_DETAILS_SCHEMA: Json = {
  type: 'object',
  description: 'RFC 9457 Problem Details (CLAUDE.md §2).',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string', enum: PROBLEM_CATALOG.map((p) => p.code) },
    detail: { type: 'string' },
    instance: { type: 'string' },
    errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
  required: ['type', 'title', 'status', 'code'],
  additionalProperties: true,
};

/**
 * Assemble the OpenAPI 3.1 document from route descriptors and the problem taxonomy. Pure — no DB,
 * no Nest — so it runs both at request time (served at /openapi.json) and at build time.
 */
export function buildOpenApiDocument(routes: RouteDescriptor[], version = '1.0.0'): Json {
  const paths: Json = {};
  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const item = (paths[openApiPath] as Json | undefined) ?? {};
    item[route.method] = operationFor(route);
    paths[openApiPath] = item;
  }

  const tags = [...new Set(routes.flatMap((r) => r.tags))].sort().map((name) => ({ name }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'AgentOS Platform Foundation API',
      version,
      description: 'Identity, tenancy, and access-control kernel (CLAUDE.md §1).',
    },
    servers: [{ url: '/' }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          schema: { type: 'string', maxLength: 255 },
          description: 'Opt-in safe-retry key for mutating requests (CLAUDE.md §6).',
        },
        CorrelationId: {
          name: 'x-correlation-id',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Propagated across HTTP and events; echoed on the response.',
        },
      },
      headers: {
        'RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed in the window.' },
        'RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests remaining in the window.' },
        'RateLimit-Reset': { schema: { type: 'integer' }, description: 'Seconds until the window resets.' },
      },
      schemas: { ProblemDetails: PROBLEM_DETAILS_SCHEMA },
      responses: problemResponses(),
    },
  };
}
