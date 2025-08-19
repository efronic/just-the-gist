/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: null,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    es2020: true,
    browser: true,
    webextensions: true,
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    'prefer-arrow-callback': [
      'error',
      { allowNamedFunctions: false, allowUnboundThis: false },
    ],
    'func-style': ['error', 'expression', { allowArrowFunctions: true }],
    'no-var': 'error',
    'prefer-const': 'error',
  },
};
