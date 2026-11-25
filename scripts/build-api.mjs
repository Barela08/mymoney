/**
 * Bundles the Node API entry (server/apiEntry.ts) into a single self-contained
 * serverless function at api/[...all].js.
 *
 * Why: this project is "type": "module" and the server layer imports TypeScript
 * files with explicit `.js` specifiers. On Vercel those specifiers resolve at
 * build time but not inside the deployed function bundle, which crashed the
 * function at module load (FUNCTION_INVOCATION_FAILED on every /api/* call that
 * was routed through the catch-all). Shipping one prebundled file removes all
 * module-resolution work from the runtime.
 */
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await mkdir(path.join(root, 'api'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server', 'apiEntry.ts')],
  outfile: path.join(root, 'api', '[...all].js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'bundle',
  // Some CJS dependencies (pg, nodemailer, web-push) call require() internally.
  banner: {
    js: "import { createRequire as __freebuffCreateRequire } from 'node:module';\nconst require = __freebuffCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log('[build-api] api/[...all].js written');
