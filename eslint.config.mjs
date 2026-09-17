import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'drizzle/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { console: 'readonly', process: 'readonly', window: 'readonly', document: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', AbortController: 'readonly', URL: 'readonly', TextDecoder: 'readonly', HTMLElement: 'readonly', HTMLDivElement: 'readonly', HTMLInputElement: 'readonly', HTMLTextAreaElement: 'readonly', HTMLButtonElement: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly', requestAnimationFrame: 'readonly', localStorage: 'readonly', navigator: 'readonly' }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/**/*.{mjs,cjs,js}', '*.cjs'],
    languageOptions: { globals: { module: 'writable', exports: 'writable', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
)
