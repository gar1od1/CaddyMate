import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Numeric index loops over rings/arrays: the bound check is the loop itself.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  { ignores: ['vitest.config.ts', 'eslint.config.js'] },
);
