import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nx from '@nx/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.nx/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:platform', 'type:contracts', 'type:module'],
            },
            {
              sourceTag: 'type:module',
              onlyDependOnLibsWithTags: ['type:platform', 'type:contracts'],
            },
            {
              sourceTag: 'type:platform',
              onlyDependOnLibsWithTags: ['type:platform'],
            },
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: ['type:contracts'],
            },
            {
              sourceTag: 'scope:identity',
              onlyDependOnLibsWithTags: ['scope:identity', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:organization',
              onlyDependOnLibsWithTags: ['scope:organization', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:workspace',
              onlyDependOnLibsWithTags: ['scope:workspace', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:access',
              onlyDependOnLibsWithTags: ['scope:access', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:audit',
              onlyDependOnLibsWithTags: ['scope:audit', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:event-backbone',
              onlyDependOnLibsWithTags: [
                'scope:event-backbone',
                'scope:platform',
                'scope:contracts',
              ],
            },
            {
              // All five CRM modules share one scope (RFC-002 §3.3 / CLAUDE.md §17): they may not
              // import each other's internals or any other module — only platform + contracts.
              // Cross-CRM-module composition happens in apps/api/src/crm/ host orchestrators.
              sourceTag: 'scope:crm',
              onlyDependOnLibsWithTags: ['scope:crm', 'scope:platform', 'scope:contracts'],
            },
            {
              sourceTag: 'scope:platform',
              onlyDependOnLibsWithTags: ['scope:platform'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
