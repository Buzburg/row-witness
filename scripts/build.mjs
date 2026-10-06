import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const worker = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const app = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true, define: { __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) } });
const js = app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile('src/styles.css', 'utf8');
const hash = createHash('sha256').update(js).digest('base64');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; worker-src blob:; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="description" content="Find what changed between two CSV exports. Private, offline, and open source. No uploads. No account.">
<meta name="theme-color" content="#153a38">
<title>Row Witness — Know what changed.</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%23153a38'/%3E%3Cpath d='M12 15h24M12 24h15M12 33h24' stroke='%23f0f4eb' stroke-width='4'/%3E%3C/svg%3E">
<style>${css}</style>
</head>
<body><div id="app"></div><noscript>Row Witness needs JavaScript to compare files on this device. Nothing is uploaded.</noscript><script>${js}</script></body>
</html>
`;
await mkdir('dist', { recursive: true });
await writeFile('dist/row-witness.html', html);
await writeFile('dist/SHA256SUMS.txt', `${createHash('sha256').update(html).digest('hex')}  row-witness.html\n`);
console.log(`Built dist/row-witness.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB). No runtime dependencies.`);
