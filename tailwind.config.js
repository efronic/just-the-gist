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
          /* New Green Palette: DAD7CD (light), A3B18A, 588157, 3A5A40, 344E41 (deep) */
          primary: '#3A5A40', // rich mid-dark green for primary actions
          'primary-focus': '#344E41', // deeper green for active/focus
          'primary-content': '#ffffff',
          secondary: '#588157', // supporting medium green
          'secondary-focus': '#4d734d',
          accent: '#A3B18A', // soft accent
          'accent-focus': '#8d9c76',
          neutral: '#344E41', // deep green as neutral/dark base
          'neutral-content': '#ffffff',
          info: '#DAD7CD',
          success: '#588157',
          warning: '#A3B18A',
          error: '#f43f5e',
          '--rounded-btn': '0.375rem',
        },
      },
      'dark',
    ],
    darkTheme: 'dark',
    logs: false,
  },
};
