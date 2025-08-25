/** @type {import('tailwindcss').Config} */
import daisyui from 'daisyui';

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
          primary: '#f97316',
          'primary-focus': '#ea580c',
          'primary-content': '#ffffff',
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
    logs: false,
  },
};
