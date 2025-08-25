import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { emitScssTokens } from './design-tokens.mjs';

const root = path.resolve(process.cwd());
const dist = path.join(root, 'dist');

/** Simple recursive copy */
function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirSync(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else copyFileSync(s, d);
  }
}

function copyStatic() {
  const files = [
    ['src/popup.html', 'dist/popup.html'],
    ['src/options.html', 'dist/options.html'],
  ];
  for (const [src, dest] of files) {
    const s = path.join(root, src);
    const d = path.join(root, dest);
    if (fs.existsSync(s)) copyFileSync(s, d);
  }
  // Also copy icons directory so manifest icon paths resolve regardless of load root
  copyDirSync(path.join(root, 'icons'), path.join(root, 'dist/icons'));
}

function compileTailwind() {
  // New SCSS design system entry
  const input = path.join(root, 'src/styles/design-system.scss');
  const output = path.join(root, 'dist/tailwind.css');
  if (!fs.existsSync(input)) return;
  // Generate auto token file consumed by design-system.scss (optional import spot)
  const autoTokenPath = path.join(root, 'src/styles/_auto-tokens.scss');
  emitScssTokens(autoTokenPath, fs);
  try {
    execSync(`npx tailwindcss -i "${input}" -o "${output}" --minify`, { stdio: 'inherit' });
  } catch (err) {
    console.warn(
      '[build] Tailwind (SCSS) compile failed. Did you run npm install?\n',
      err?.message || err
    );
  }
}

function emitManifestForDist() {
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const stripDist = (p) => (typeof p === 'string' ? p.replace(/^dist\//, '') : p);

  // Adjust paths because manifest will live inside dist/
  if (manifest.action?.default_popup) {
    manifest.action.default_popup = stripDist(manifest.action.default_popup);
  }
  if (manifest.background?.service_worker) {
    manifest.background.service_worker = stripDist(manifest.background.service_worker);
  }
  if (manifest.options_page) {
    manifest.options_page = stripDist(manifest.options_page);
  }
  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((cs) => {
      if (Array.isArray(cs.js)) cs.js = cs.js.map(stripDist);
    });
  }

  // Icons are copied as-is into dist/icons and paths remain the same
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function main() {
  const watch = process.argv.includes('--watch');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  const ctx = await build({
    entryPoints: [
      'src/background.ts',
      'src/contentScript.ts',
      'src/popup.ts',
      'src/options.ts',
      'src/gemini.ts',
    ],
    outdir: 'dist',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome114', 'edge114'],
    sourcemap: true,
    logLevel: 'info',
  });

  copyStatic();
  compileTailwind();
  emitManifestForDist();

  if (watch) {
    console.log('Watching for changes...');
    fs.watch(path.join(root, 'src'), { recursive: true }, async () => {
      copyStatic();
      compileTailwind();
    });
    // Re-copy icons on change as well
    if (fs.existsSync(path.join(root, 'icons'))) {
      fs.watch(path.join(root, 'icons'), { recursive: true }, async () => {
        copyStatic();
      });
    }
    // Re-emit manifest on change
    fs.watch(path.join(root, 'manifest.json'), async () => {
      emitManifestForDist();
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
