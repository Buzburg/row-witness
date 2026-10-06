import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('.test-build', { recursive: true });
await mkdir('examples', { recursive: true });
await build({ entryPoints: ['src/demo.ts', 'src/exports.ts'], outdir: '.test-build', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const { demoBefore, demoAfter, demoMappings } = await import(pathToFileURL(resolve('.test-build/demo.mjs')).href);
const { exportRecipe } = await import(pathToFileURL(resolve('.test-build/exports.mjs')).href);
await writeFile(`examples/${demoBefore.name}`, demoBefore.text);
await writeFile(`examples/${demoAfter.name}`, demoAfter.text);
await writeFile('examples/customer-recipe.json', exportRecipe(demoMappings, { trimWhitespace: false, ignoreCase: false }));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve('dist/row-witness.html')).href);
  await page.screenshot({ path: 'docs/start.png', fullPage: true });
  await page.getByRole('button', { name: 'Try a sample comparison' }).click();
  await page.getByText('Comparison complete', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Changed', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect record 00102', exact: true }).click();
  await page.locator('#results').screenshot({ path: 'docs/screenshot.png' });
  console.log('Saved synthetic example files and real application screenshots.');
} finally {
  await browser.close();
}
