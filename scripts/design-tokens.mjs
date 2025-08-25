// Source-of-truth design tokens (light, dark, alt)
// Run via build script to emit SCSS tokens + feed Tailwind/DaisyUI.

export const palette = {
  green50: '#F0F1EE',
  green100: '#E4E7E1',
  green200: '#DAD7CD',
  green300: '#A3B18A',
  green400: '#79966D',
  green500: '#588157',
  green600: '#4D734D',
  green650: '#456643',
  green700: '#3A5A40',
  green800: '#344E41',
  green900: '#283B32',
  error: '#f43f5e',
  warning: '#E7C96A',
};

// Theme semantic mapping
export const themes = {
  light: {
    primary: palette.green700,
    primaryHover: palette.green800,
    primaryActive: palette.green800,
    primaryFg: '#FFFFFF',
    secondary: palette.green500,
    secondaryHover: palette.green600,
    secondaryActive: palette.green650,
    secondaryFg: '#FFFFFF',
    accent: palette.green300,
    accentHover: palette.green400,
    accentActive: palette.green500,
    accentFg: '#1E2A23',
    neutral: palette.green800,
    neutralHover: palette.green900,
    neutralActive: palette.green900,
    neutralFg: '#FFFFFF',
    bg: '#FFFFFF',
    bgAlt: '#F7F8F6',
    surface: '#FFFFFF',
    surfaceAlt: palette.green100,
    border: '#D5DAD6',
    borderStrong: '#B9C1BA',
    text: '#1F2722',
    textSoft: '#4A5A50',
    textFaint: '#6B7A71',
    info: palette.green200,
    success: palette.green500,
    warning: palette.warning,
    error: palette.error,
    focusRing: 'rgba(58,90,64,0.55)',
  },
  dark: {
    primary: palette.green700,
    primaryHover: palette.green600,
    primaryActive: palette.green600,
    primaryFg: '#FFFFFF',
    secondary: palette.green500,
    secondaryHover: palette.green400,
    secondaryActive: palette.green300,
    secondaryFg: '#FFFFFF',
    accent: palette.green300,
    accentHover: palette.green400,
    accentActive: palette.green500,
    accentFg: '#1E2A23',
    neutral: palette.green800,
    neutralHover: palette.green700,
    neutralActive: palette.green700,
    neutralFg: '#FFFFFF',
    bg: '#1E2421',
    bgAlt: '#242C28',
    surface: '#28312D',
    surfaceAlt: '#2F3A35',
    border: '#3C4943',
    borderStrong: '#4A5952',
    text: '#EEF2EF',
    textSoft: '#C7D0CB',
    textFaint: '#9EAAA4',
    info: palette.green200,
    success: palette.green500,
    warning: palette.warning,
    error: palette.error,
    focusRing: 'rgba(163,177,138,0.55)',
  },
  // Alt brand (lighter primary, swap accent/primary emphasis)
  alt: {
    primary: palette.green500, // shift to medium green
    primaryHover: palette.green600,
    primaryActive: palette.green650,
    primaryFg: '#FFFFFF',
    secondary: palette.green700,
    secondaryHover: palette.green800,
    secondaryActive: palette.green800,
    secondaryFg: '#FFFFFF',
    accent: palette.green300,
    accentHover: palette.green400,
    accentActive: palette.green500,
    accentFg: '#1E2A23',
    neutral: palette.green800,
    neutralHover: palette.green900,
    neutralActive: palette.green900,
    neutralFg: '#FFFFFF',
    bg: '#FFFFFF',
    bgAlt: '#F7F8F6',
    surface: '#FFFFFF',
    surfaceAlt: palette.green100,
    border: '#D5DAD6',
    borderStrong: '#B9C1BA',
    text: '#1F2722',
    textSoft: '#4A5A50',
    textFaint: '#6B7A71',
    info: palette.green200,
    success: palette.green500,
    warning: palette.warning,
    error: palette.error,
    focusRing: 'rgba(88,129,87,0.55)',
  },
};

export const typography = {
  familySans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont',
  familyMono:
    'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
  sizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    base: '0.875rem',
    md: '0.9375rem',
    lg: '1.0625rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  },
  lineHeights: {
    snug: 1.3,
    normal: 1.45,
    relaxed: 1.6,
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export function emitScssTokens(outPath, fs) {
  const buildThemeBlock = (name, t) =>
    `/* ${name} theme custom properties */\n${name === 'light' ? ':root' : name === 'dark' ? "[data-theme='dark']" : "[data-theme='alt']"} {\n  --color-primary: ${t.primary};\n  --color-primary-hover: ${t.primaryHover};\n  --color-primary-active: ${t.primaryActive};\n  --color-primary-fg: ${t.primaryFg};\n  --color-secondary: ${t.secondary};\n  --color-secondary-hover: ${t.secondaryHover};\n  --color-secondary-active: ${t.secondaryActive};\n  --color-secondary-fg: ${t.secondaryFg};\n  --color-accent: ${t.accent};\n  --color-accent-hover: ${t.accentHover};\n  --color-accent-active: ${t.accentActive};\n  --color-accent-fg: ${t.accentFg};\n  --color-bg: ${t.bg};\n  --color-bg-alt: ${t.bgAlt};\n  --color-surface: ${t.surface};\n  --color-surface-alt: ${t.surfaceAlt};\n  --color-border: ${t.border};\n  --color-border-strong: ${t.borderStrong};\n  --color-text: ${t.text};\n  --color-text-soft: ${t.textSoft};\n  --color-text-faint: ${t.textFaint};\n  --color-info: ${t.info};\n  --color-success: ${t.success};\n  --color-warning: ${t.warning};\n  --color-error: ${t.error};\n  --color-focus-ring: ${t.focusRing};\n}`;

  const header = `// AUTO-GENERATED from scripts/design-tokens.mjs. DO NOT EDIT DIRECTLY.\n`;
  const paletteLines = Object.entries(palette)
    .map(([k, v]) => `$${k}: ${v};`)
    .join('\n');
  const scss = `${header}\n${paletteLines}\n\n${Object.entries(themes)
    .map(([n, t]) => buildThemeBlock(n, t))
    .join('\n\n')}`;
  fs.writeFileSync(outPath, scss, 'utf8');
}
