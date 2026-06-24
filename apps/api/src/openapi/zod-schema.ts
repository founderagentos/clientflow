import { z, type ZodType } from 'zod';

/**
 * Convert a Zod schema to JSON Schema (2020-12) for OpenAPI 3.1, which is a JSON-Schema-2020-12
 * superset — so Zod v4's native `toJSONSchema` covers it with no third-party dependency (CLAUDE.md §6
 * decision). `io: 'input'` reflects request-side optionality (fields with defaults are optional).
 */
export function zodToJsonSchema(
  schema: ZodType,
  io: 'input' | 'output' = 'output',
): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  // The top-level `$schema` dialect marker is redundant inside an OpenAPI components object.
  delete json.$schema;
  return json;
}

/** Rewrite Nest-style path params (`:id`) to OpenAPI form (`{id}`). */
export function toOpenApiPath(nestPath: string): string {
  return nestPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Extract path-parameter names from a Nest-style path. */
export function pathParamNames(nestPath: string): string[] {
  return [...nestPath.matchAll(/:([A-Za-z0-9_]+)/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}
