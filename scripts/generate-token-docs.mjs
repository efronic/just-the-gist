#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { palette, themes, typography } from './design-tokens.mjs';

function section(title, body) {
  return `\n## ${title}\n\n${body}\n`;
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '-').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${head}\n${body}`;
}

function colorSwatch(hex) {
  return `<span style="display:inline-block;width:1.25rem;height:1.25rem;border-radius:4px;background:${hex};border:1px solid #ccc;vertical-align:middle;margin-right:4px"></span>${hex}`;
}

const paletteRows = Object.entries(palette).map(([name, hex]) => [name, colorSwatch(hex)]);

const themeRows = Object.entries(themes.light).map(([k, v]) => [
  k,
  colorSwatch(v),
  themes.dark[k] || '',
  themes.alt[k] || '',
]);

const typoRows = Object.entries(typography.sizes)
  .map(([k, v]) => [`font-size-${k}`, v])
  .concat(Object.entries(typography.lineHeights).map(([k, v]) => [`line-height-${k}`, String(v)]))
  .concat(Object.entries(typography.weights).map(([k, v]) => [`weight-${k}`, String(v)]));

const md = `# Design Tokens\n\nGenerated token reference. Do not edit manually; run \`npm run build\` (or invoke \`node scripts/generate-token-docs.mjs\`) after changing tokens.\n\n### Source Files\n- \`scripts/design-tokens.mjs\` (authoritative JS token map)\n- Emitted: \`src/styles/_auto-tokens.scss\`\n\n${section('Palette', table(['Token', 'Hex'], paletteRows))}\n${section('Semantic Theme Values', table(['Semantic', 'Light', 'Dark', 'Alt'], themeRows))}\n${section('Typography', table(['Token', 'Value'], typoRows))}\n\n### Usage\n- CSS variables: e.g. \`var(--color-primary)\` from the appropriate \`data-theme\` context.\n- Tailwind utilities: DaisyUI theme keys (\`bg-primary\`, \`text-secondary\`) reflect the same values.\n- SCSS mixins: button variants via \`.gbtn\`, \`.gbtn-secondary\`, etc.\n\n### Regeneration\n\nRun: \n\n\nnode scripts/generate-token-docs.mjs\n\n\n`;

const outPath = path.join(process.cwd(), 'docs', 'TOKENS.md');
fs.writeFileSync(outPath, md, 'utf8');
console.log('[tokens-doc] Wrote', outPath);
