import { describe, expect, it } from 'vitest';
import { ValidationError } from '@agentos/result-errors';
import { isPermissionKey, parsePermissionKey, permissionKey } from './permission-key';

describe('permission-key', () => {
  it('accepts valid resource.action keys', () => {
    expect(isPermissionKey('lead.read')).toBe(true);
    expect(isPermissionKey('service_account.create')).toBe(true);
    expect(parsePermissionKey('agent.execute')).toBe('agent.execute');
  });

  it('rejects malformed keys with a 422', () => {
    for (const bad of ['lead', 'Lead.Read', 'lead.', '.read', 'lead.read.extra', 'lead read']) {
      expect(() => parsePermissionKey(bad)).toThrow(ValidationError);
    }
  });

  it('composes a key from resource + action', () => {
    expect(permissionKey('role', 'assign')).toBe('role.assign');
  });
});
