/**
 * RFC 9457 Problem Details (CLAUDE.md §2 — application/problem+json).
 * `code` is our stable, machine-readable extension to the standard members.
 */
export interface ProblemDetails {
  /** URI reference identifying the problem type. */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Stable, machine-readable error code (AgentOS extension). */
  code: string;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** URI reference identifying the specific occurrence. */
  instance?: string;
  /** Field-level validation errors (extension). */
  errors?: Record<string, string[]>;
  /** Additional problem-type-specific members. */
  [key: string]: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
