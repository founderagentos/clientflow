import { describe, it, expect } from 'vitest';
import { newId, isValidId, isUuidV7 } from './identifier';

describe('identifier', () => {
  it('generates a well-formed UUID', () => {
    expect(isValidId(newId())).toBe(true);
  });

  it('generates a version-7 UUID (insert-ordered)', () => {
    expect(isUuidV7(newId())).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
  });

  it('produces time-ordered ids (generation order == lexical sort order)', () => {
    const ids = Array.from({ length: 500 }, () => newId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('rejects non-uuid strings', () => {
    expect(isValidId('not-a-uuid')).toBe(false);
    expect(isUuidV7('00000000-0000-4000-8000-000000000000')).toBe(false);
  });
});
