import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appUrl = pathToFileURL(resolve('dist/row-witness.html')).href;
async function upload(page: Page, side: 'before' | 'after', text: string | Buffer, name = `${side}.csv`): Promise<void> {
  await page.locator(`#${side}-file`).setInputFiles({ name, mimeType: 'text/csv', buffer: typeof text === 'string' ? Buffer.from(text) : text });
}
async function compare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Compare files →', exact: true }).click();
  await expect(page.getByText('Comparison complete', { exact: true })).toBeVisible();
}
async function sample(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Try a sample comparison' }).click();
  await expect(page.getByText('Comparison complete', { exact: true })).toBeVisible();
}
async function downloadedText(page: Page, label: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  return readFile(path!, 'utf8');
}

test.beforeEach(async ({ page }) => { await page.goto(appUrl); });

test('sample works offline, accounts for exceptions, and makes no network requests', async ({ page, context }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await context.setOffline(true);
  await page.reload();
  await sample(page);
  for (const [status, count] of [['changed', '4'], ['added', '2'], ['removed', '2'], ['conflict', '3'], ['unchanged', '6']]) {
    await expect(page.locator(`.stat-${status} .stat-value`)).toHaveText(count!);
  }
  await expect(page.locator('.record-accounting')).toContainText('15 before records → 14 after records');
  await page.getByRole('button', { name: 'Needs review', exact: true }).click();
  await expect(page.locator('.results-table tbody > tr:not([hidden])').first()).toBeVisible();
  await page.getByRole('button', { name: 'Inspect record 00113', exact: true }).click();
  await expect(page.locator('.original-grid')).toContainText('Westward Books');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('downloads preserve complete evidence and source hashes, including BOM', async ({ page }) => {
  const before = '\uFEFFid,value\r\n001,old\r\n002,same\r\n';
  const after = 'id,value\n002,same\n001,new\n003,added';
  await upload(page, 'before', before);
  await upload(page, 'after', after);
  await compare(page);
  const evidence = JSON.parse(await downloadedText(page, '↓ Full JSON'));
  expect(evidence.comparison.before.sha256).toBe(createHash('sha256').update(before).digest('hex'));
  expect(evidence.comparison.after.sha256).toBe(createHash('sha256').update(after).digest('hex'));
  expect(evidence.comparison.counts).toEqual({ added: 1, removed: 0, changed: 1, unchanged: 1, conflict: 0 });
  expect(evidence.totals.beforeRecords).toBe(2);
  expect(evidence.totals.afterRecords).toBe(3);
  const html = await downloadedText(page, '↓ HTML report');
  expect(html).toContain('Content-Security-Policy');
  expect(html).toContain('001');
  expect(html).not.toContain('<script');
  const csv = await downloadedText(page, '↓ Changes CSV');
  expect(csv).toContain('source_record');
  expect(csv).toContain('001');
});

test('manually maps differently named columns and compares composite keys', async ({ page }) => {
  await upload(page, 'before', 'order,line,quantity\nA,1,10\nA,2,20');
  await upload(page, 'after', 'order,item,quantity\nA,2,21\nA,1,10');
  await expect(page.getByLabel('Before column for pair 1')).toBeVisible();
  await page.getByRole('button', { name: '+ Add column pair' }).click();
  await page.getByLabel('Before column for pair 3').selectOption('line');
  await page.getByLabel('After column for pair 3').selectOption('item');
  await page.getByLabel('Role for column pair 3').selectOption('key');
  await compare(page);
  const evidence = JSON.parse(await downloadedText(page, '↓ Full JSON'));
  expect(evidence.comparison.counts.changed).toBe(1);
  expect(evidence.comparison.counts.unchanged).toBe(1);
  expect(evidence.comparison.counts.conflict).toBe(0);
});

test('treats HTML and spreadsheet formulas as data', async ({ page }) => {
  await upload(page, 'before', 'id,value\n001,safe');
  await upload(page, 'after', 'id,value\n001,<img src=x onerror=alert(1)>\n002,=1+1');
  await compare(page);
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('.result-table-area')).toContainText('<img src=x onerror=alert(1)>');
  const html = await downloadedText(page, '↓ HTML report');
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<img src=x');
  expect(await downloadedText(page, '↓ Changes CSV')).toContain("'=1+1");
});

test('marks changed settings stale, disables export, and clears retained UI data', async ({ page }) => {
  await sample(page);
  await page.getByLabel('Role for column pair 2').selectOption('key');
  await expect(page.getByText('These results are from an earlier comparison.')).toBeVisible();
  await expect(page.getByRole('button', { name: '↓ Full JSON', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.getByRole('button', { name: '↓ Full JSON', exact: true })).toHaveCount(0);
  await expect(page.getByText('customers-monday.csv', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.stat-card')).toHaveCount(0);
});

test('reports malformed CSV, invalid UTF-8 and oversized inputs', async ({ page }) => {
  await upload(page, 'before', 'id,value\n1,too,many');
  await expect(page.locator('.source-message').first()).toContainText('Expected 2 fields');
  await upload(page, 'before', Buffer.from([0x69, 0x64, 0x0a, 0xff]));
  await expect(page.locator('.source-message').first()).toContainText('UTF-8');
  await upload(page, 'before', Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  await expect(page.locator('.source-message').first()).toContainText('10 MiB');
  await expect(page.getByRole('button', { name: 'Compare files →', exact: true })).toBeDisabled();
});

test('recipe roundtrip excludes data and rejects unsupported fields', async ({ page }) => {
  await sample(page);
  const recipe = await downloadedText(page, 'Save recipe');
  expect(recipe).not.toContain('Northstar');
  expect(recipe).not.toContain('customers-monday.csv');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.locator('#recipe-file').setInputFiles({ name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(recipe) });
  await expect(page.locator('.notice')).toContainText('Recipe loaded');
  const bad = JSON.stringify({ ...JSON.parse(recipe), rows: ['private'] });
  await page.locator('#recipe-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(bad) });
  await expect(page.locator('.notice')).toContainText('Could not load recipe');
});

test('a recipe loaded before files does not overwrite later rule choices', async ({ page }) => {
  const recipe = { format: 'row-witness-recipe', version: 1, mappings: [
    { before: 'id', after: 'id', role: 'key' }, { before: 'value', after: 'value', role: 'compare' },
  ], options: { trimWhitespace: false, ignoreCase: false } };
  await page.locator('#recipe-file').setInputFiles({ name: 'recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recipe)) });
  await expect(page.locator('.notice')).toContainText('Recipe loaded');
  await page.getByLabel('Trim outer whitespace').check();
  await upload(page, 'before', 'id,value\n001,x');
  await upload(page, 'after', 'id,value\n001, x');
  await compare(page);
  await expect(page.getByLabel('Trim outer whitespace')).toBeChecked();
  await expect(page.locator('.stat-unchanged .stat-value')).toHaveText('1');
});

test('replacing result controls cannot revive an invisible search filter', async ({ page }) => {
  await sample(page);
  await page.clock.install();
  await page.getByRole('searchbox').fill('Northstar');
  await page.getByLabel('Trim outer whitespace').check();
  await page.clock.fastForward(300);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await page.getByRole('button', { name: 'All records', exact: true }).click();
  await expect(page.locator('.pagination')).toContainText('17');
  await expect(page.locator('.results-table tbody > tr:not([hidden])')).toHaveCount(17);
});

test('downloaded HTML report opens independently with networking disabled', async ({ page, context }, testInfo) => {
  await sample(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ HTML report', exact: true }).click();
  const path = testInfo.outputPath('row-witness-report.html');
  await (await pending).saveAs(path);
  const report = await context.newPage();
  await context.setOffline(true);
  await report.goto(pathToFileURL(path).href);
  await expect(report.getByRole('heading', { name: 'What changed between these exports' })).toBeVisible();
  await expect(report.locator('body')).toContainText('15 before records and 14 after records');
  await expect(report.locator('script')).toHaveCount(0);
  await expect(report.locator('body')).toContainText('Westward Books');
  await report.close();
});

test('20,000 records compare and paginate without inflating rendered rows', async ({ page }) => {
  test.setTimeout(40_000);
  const rows = Array.from({ length: 20_000 }, (_, index) => `${index},value-${index}`);
  await upload(page, 'before', 'id,value\n' + rows.join('\n'));
  rows[10] = '10,changed';
  await upload(page, 'after', 'id,value\n' + rows.reverse().join('\n'));
  await compare(page);
  await expect(page.locator('.stat-changed .stat-value')).toHaveText('1');
  await expect(page.locator('.stat-unchanged .stat-value')).toHaveText('19,999');
  const renderedRows = await page.locator('.results-table tbody > tr').count();
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThanOrEqual(50);
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await expect(page.getByRole('button', { name: '← Previous', exact: true })).toBeEnabled();
  await page.getByRole('searchbox').fill('value-19999');
  await expect(page.locator('.result-table-area')).toContainText('19999');
});

test('keyboard and accessibility checks pass in empty and completed states', async ({ page }) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to comparison' })).toBeFocused();
  let audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  await sample(page);
  audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  await page.getByRole('button', { name: 'Inspect record 00102', exact: true }).click();
  await page.getByText('Comparison rules & file fingerprints', { exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map(issue => ({ id: issue.id, targets: issue.nodes.map(node => node.target) }))).toEqual([]);
});

test('layout stays within the viewport from mobile to desktop', async ({ page }) => {
  await sample(page);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll, `${width}px viewport`).toBeLessThanOrEqual(dimensions.client);
  }
});
