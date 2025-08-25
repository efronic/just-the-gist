/** @type {import('tailwindcss').Config} */
import daisyui from 'daisyui';
import { themes } from './scripts/design-tokens.mjs';

export default {
  content: ['./src/**/*.html', './src/**/*.ts', './dist/**/*.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'Liberation Sans',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      fontSize: {
        '2xs': '0.65rem',
      },
    },
  },
  // Allow daisyUI preflight (keeps most resets minimal); if conflict arises revert.
  corePlugins: {},
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        gistlight: {
          ...require('daisyui/src/theming/themes')['[data-theme=light]'],
          primary: themes.light.primary,
          'primary-focus': themes.light.primaryHover,
          'primary-content': themes.light.primaryFg,
          secondary: themes.light.secondary,
          'secondary-focus': themes.light.secondaryHover,
          accent: themes.light.accent,
          'accent-focus': themes.light.accentHover,
          neutral: themes.light.neutral,
          'neutral-content': themes.light.neutralFg,
          info: themes.light.info,
          success: themes.light.success,
          warning: themes.light.warning,
          error: themes.light.error,
          '--rounded-btn': '0.375rem',
        },
        gistalt: {
          ...require('daisyui/src/theming/themes')['[data-theme=light]'],
          primary: themes.alt.primary,
          'primary-focus': themes.alt.primaryHover,
          'primary-content': themes.alt.primaryFg,
          secondary: themes.alt.secondary,
          'secondary-focus': themes.alt.secondaryHover,
          accent: themes.alt.accent,
          'accent-focus': themes.alt.accentHover,
          neutral: themes.alt.neutral,
          'neutral-content': themes.alt.neutralFg,
          info: themes.alt.info,
          success: themes.alt.success,
          warning: themes.alt.warning,
          error: themes.alt.error,
          '--rounded-btn': '0.375rem',
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
    logs: false,
  },
};
