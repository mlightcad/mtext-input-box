import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, prettier, {
  files: ['**/*.ts'],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json'
    }
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off'
  }
});
