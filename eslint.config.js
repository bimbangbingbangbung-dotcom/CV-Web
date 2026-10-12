import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.lighthouseci/',
      'public/',
      'admin/',
      // OpenCode plugin + vendored community skills — not site code.
      '.opencode/',
      // Generated file: schema-compiled validator (see scripts/generate-validator.mjs)
      'src/utils/content-validator.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Node-side tooling: build scripts, configs, e2e tests. These talk to the
    // terminal, so console output is the point. Must come AFTER the generic
    // block above — in flat config, later entries win for the same file.
    files: ['scripts/**/*.mjs', '*.config.ts', 'eslint.config.js', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
