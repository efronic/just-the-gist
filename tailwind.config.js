/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.html', './src/**/*.ts', './dist/**/*.html'],
  theme: {
    extend: {},
  },
  corePlugins: {
    preflight: false, // keep extension defaults stable
  },
  plugins: [],
};
