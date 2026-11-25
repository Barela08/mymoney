/**
 * Builds the catch-all API serverless function: server/apiEntry.ts -> api/[...all].js
 *
 * Why the compiled bundle is committed:
 *   This project is "type": "module" and the server layer imports TypeScript
 *   files with explicit `.js` specifiers. When Vercel ran the original
 *   api/[...all].ts, those specifiers did not resolve inside the deployed
 *   function bundle, so every /api/* request died at module load with
 *   FUNCTION_INVOCATION_FAILED.
 *
 *   Vercel collects the functions in `api/` from the source snapshot it takes
 *   before the build command runs, so a file emitted during `npm run build`
 *   is never uploaded as a function. The self-contained bundle therefore has
 *   to live in the repository.
 *
 * Usage:
 *   node scripts/build-api.mjs          # rewrite the committed bundle
 *   node scripts/build-api.mjs --check  # fail if the committed bundle is stale
 */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'api', '[...all].js');
const check = process.argv.includes('--check');

const result = await build({
  entryPoints: [path.join(root, 'server', 'apiEntry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'bundle',
  // Some CJS dependencies (pg, nodemailer, web-push) call require() internally.
  banner: {
    js: "import { createRequire as __freebuffCreateRequire } from 'node:module';\nconst require = __freebuffCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
  write: !check,
});

if (check) {
  const code = result.outputFiles?.[0]?.text;
  const current = await readFile(outfile, 'utf8').catch(() => null);
  if (current !== code) {
    console.error(
      '[build-api] api/[...all].js is out of date with server/ sources.\n' +
        '           Run `npm run build:api` and commit the result.',
    );
    process.exit(1);
  }
  console.log('[build-api] api/[...all].js is up to date');
} else {
  console.log('[build-api] api/[...all].js written');
}
