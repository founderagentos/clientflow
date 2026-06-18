import { randomBytes } from 'node:crypto';

/**
 * Build a globally-unique organization slug. `organizations.slug` is unique platform-wide
 * (organizations_slug_key), so a human-readable base derived from the display name is suffixed
 * with random entropy to avoid collisions across independent registrations.
 */
export function buildOrganizationSlug(displayName: string): string {
  const base =
    displayName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';
  const suffix = randomBytes(4).toString('hex');
  return `${base}-${suffix}`;
}
