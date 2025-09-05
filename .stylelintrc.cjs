module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-config-standard-scss'],
  overrides: [
    {
      files: ['src/styles/_auto-tokens.scss', 'src/styles/_tokens.scss'],
      rules: {
        'color-no-hex': null,
        'color-hex-length': null,
        'alpha-value-notation': null,
        'color-function-notation': null,
      },
    },
  ],
  rules: {
    // Core design governance
    'color-no-hex': true,
    'color-hex-length': 'short',
    'alpha-value-notation': 'number',
    'color-function-notation': 'legacy',

    // Allow Tailwind & DaisyUI / PostCSS specific at-rules
    'scss/at-rule-no-unknown': [true, { ignoreAtRules: ['tailwind', 'apply', 'layer', 'config'] }],

    // Relax noisy / subjective stylistic rules (focus is color enforcement)
    'selector-id-pattern': null,
    'no-descending-specificity': null,
    'font-family-name-quotes': null,
    'value-keyword-case': null,
    'scss/dollar-variable-empty-line-before': null,

    // Keep other relaxed defaults / project allowances
    'declaration-no-important': null,
    'selector-class-pattern': null,
    'no-empty-source': null,
    'property-no-unknown': [true, { ignoreSelectors: [':export'] }],
    'scss/dollar-variable-pattern': null,
    'function-no-unknown': [true, { ignoreFunctions: ['theme', 'color-mix'] }],
    // Disable import-notation noise for Google Fonts URL usage style
    'import-notation': null,
  },
};
