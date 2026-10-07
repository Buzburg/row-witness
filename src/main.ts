import { cancelWork, parseSource, runComparison } from './client';
import { suggestMappings, validateRecipe } from './core';
import { demoAfter, demoBefore, demoMappings } from './demo';
import { exportCsv, exportHtml, exportJson, exportRecipe } from './exports';
import type { ColumnMapping, CompareOptions, Comparison, DelimiterChoice, DiffRow, RowStatus, SourceInput, SourceRow, Table } from './types';

const MAX_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 25;
const statusOrder: RowStatus[] = ['changed', 'added', 'removed', 'conflict', 'unchanged'];
const statusNames: Record<RowStatus, string> = {
  changed: 'Changed', added: 'Added', removed: 'Removed', conflict: 'Needs review', unchanged: 'Unchanged',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const result = element('button', className, text);
  result.type = 'button';
  result.addEventListener('click', onClick);
  return result;
}

function selectOption(value: string, label: string): HTMLOptionElement {
  const option = element('option', '', label);
  option.value = value;
  return option;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function formatNumber(value: number): string { return value.toLocaleString(); }

function download(content: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = element('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface SourceState {
  side: 'before' | 'after';
  table: Table | null;
  input: SourceInput | null;
  version: number;
  loading: boolean;
  panel: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
  message: HTMLElement;
  file: HTMLInputElement;
  delimiter: HTMLSelectElement;
  paste: HTMLTextAreaElement;
  pasteButton: HTMLButtonElement;
}

let mappings: ColumnMapping[] = [];
let comparison: Comparison | null = null;
let sampleComparison: Comparison | null = null;
let stale = false;
let revision = 0;
let comparing = false;
let filter: RowStatus | 'all' = 'all';
let query = '';
let page = 0;
let pendingRecipe: { mappings: ColumnMapping[]; options: CompareOptions } | null = null;
let searchTimeout = 0;
let demoGeneration = 0;
let recipeGeneration = 0;

const root = document.getElementById('app');
if (!root) throw new Error('Application container is missing.');

const app = element('main', 'app');
const skip = element('a', 'skip-link', 'Skip to comparison');
skip.href = '#compare-section';
const header = element('header', 'site-header');
const brand = element('a', 'brand');
brand.href = '#';
brand.setAttribute('aria-label', 'Row Witness home');
const brandMark = element('span', 'brand-mark');
brandMark.setAttribute('aria-hidden', 'true');
brandMark.append(element('span'), element('span'), element('span'), element('span'));
brand.append(brandMark, element('span', '', 'Row Witness'));
const headerTools = element('div', 'header-tools');
const localBadge = element('span', 'local-badge', 'Runs on your device');
localBadge.prepend(element('span', 'local-dot'));
const clearButton = button('Clear all', 'button button-quiet', reset);
headerTools.append(localBadge, clearButton);
header.append(brand, headerTools);

const intro = element('section', 'intro');
const introCopy = element('div');
introCopy.append(element('p', 'eyebrow', 'A little certainty for your next step'), element('h1', '', 'Two exports. The whole story.'));
introCopy.append(element('p', 'intro-description', 'See what changed, what disappeared, and what needs a closer look. Compare CSV files by the records inside them.'));
const introAction = element('div', 'intro-action');
const demoButton = button('Try a sample comparison', 'button button-dark', () => { void loadDemo(); });
introAction.append(demoButton, element('span', 'small muted', 'One click: compare fictional customer exports.'));
intro.append(introCopy, introAction);

const privacy = element('div', 'privacy-strip');
privacy.append(element('span', 'privacy-symbol', '↳'), element('strong', '', 'Your files stay yours.'), element('span', '', 'No uploads. No account. No saved data. Works offline.'));

const sourceSection = element('section', 'source-section');
sourceSection.setAttribute('aria-labelledby', 'source-heading');
sourceSection.append(sectionHeading('01', 'Choose your files', 'UTF-8 CSV or TSV · Up to 10 MiB, 100,000 records & 2 million cells per file', 'source-heading'));
const sourceGrid = element('div', 'source-grid');
const before = createSource('before', 'Before', 'The original export');
const after = createSource('after', 'After', 'The newer export');
sourceGrid.append(before.panel, after.panel);
sourceSection.append(sourceGrid);

const configSection = element('section', 'config-section');
configSection.id = 'compare-section';
configSection.setAttribute('aria-labelledby', 'mapping-heading');
const configHeader = sectionHeading('02', 'Match what matters', 'Match records by a unique ID, or a combination of columns.', 'mapping-heading');
const recipeControls = element('div', 'recipe-controls');
const importInput = element('input', 'visually-hidden');
importInput.type = 'file';
importInput.accept = '.json,application/json';
importInput.id = 'recipe-file';
importInput.tabIndex = -1;
importInput.setAttribute('aria-label', 'Recipe JSON file');
const importButton = button('Import recipe', 'button button-small button-quiet', () => importInput.click());
importInput.addEventListener('change', () => { const file = importInput.files?.[0]; if (file) void importRecipeFile(file); });
const recipeButton = button('Save recipe', 'button button-small button-quiet', () => {
  try { download(exportRecipe(mappings, options()), 'application/json', 'row-witness-recipe.json'); }
  catch (error) { announce(errorMessage(error), true); }
});
recipeButton.disabled = true;
recipeControls.append(importInput, importButton, recipeButton);
configHeader.append(recipeControls);
configSection.append(configHeader);

const mappingBody = element('div', 'mapping-body');
const mappingEmpty = element('p', 'mapping-empty', 'Add both files to choose your matching keys and the columns to compare.');
const mappingGrid = element('div', 'mapping-grid');
const mappingExplanation = element('p', 'small muted', 'Keys identify the same record in both files. Compare fields are checked for changes. Remove a pair to exclude it.');
const mappingValidation = element('p', 'mapping-validation small');
mappingValidation.setAttribute('role', 'status');
mappingValidation.hidden = true;
const addMappingButton = button('+ Add column pair', 'button button-small button-outline', addMapping);
const excluded = element('p', 'excluded small');
mappingBody.append(mappingEmpty, mappingGrid, addMappingButton, mappingExplanation, mappingValidation, excluded);
configSection.append(mappingBody);

const optionsBar = element('div', 'options-bar');
const optionsGroup = element('fieldset', 'normalization');
optionsGroup.append(element('legend', '', 'Comparison rules'));
const trim = checkbox('trim-values', 'Trim outer whitespace');
const ignoreCase = checkbox('ignore-case', 'Ignore letter case');
optionsGroup.append(trim.label, ignoreCase.label);
const optionNote = element('p', 'small muted option-note', 'Exact text by default. Rules apply to both keys and compared values. Leading zeros are preserved.');
const optionsCopy = element('div', 'options-copy');
optionsCopy.append(optionsGroup, optionNote);
const compareActions = element('div', 'compare-actions');
const cancelButton = button('Cancel', 'button button-outline', cancel);
cancelButton.hidden = true;
const compareButton = button('Compare files →', 'button button-accent', () => { void compare(); });
compareButton.disabled = true;
compareActions.append(cancelButton, compareButton);
optionsBar.append(optionsCopy, compareActions);
configSection.append(optionsBar);
const notice = element('p', 'notice');
notice.setAttribute('role', 'status');
notice.setAttribute('aria-live', 'polite');
notice.hidden = true;
configSection.append(notice);

const resultsSection = element('section', 'results-section');
resultsSection.id = 'results';
resultsSection.setAttribute('aria-labelledby', 'results-heading');
resultsSection.append(sectionHeading('03', 'See the difference', 'A clear record of what changed.', 'results-heading'));
const resultBody = element('div', 'result-body');
resultsSection.append(resultBody);

const footer = element('footer', 'site-footer');
footer.append(element('span', '', 'Row Witness · Know what changed.'), element('span', '', 'Files live only in this tab. Clear or close it to start fresh.'));
app.append(header, intro, privacy, sourceSection, configSection, resultsSection, footer);
root.append(skip, app);
renderMappings();
renderResults();

function sectionHeading(number: string, title: string, description: string, id: string): HTMLElement {
  const heading = element('div', 'section-heading');
  const titleGroup = element('div', 'section-title');
  const h2 = element('h2', '', title);
  h2.id = id;
  titleGroup.append(element('span', 'step', number), h2);
  heading.append(titleGroup, element('p', 'small muted', description));
  return heading;
}

function checkbox(id: string, text: string): { input: HTMLInputElement; label: HTMLLabelElement } {
  const label = element('label', 'checkbox-label');
  const input = element('input');
  input.id = id;
  input.type = 'checkbox';
  input.addEventListener('change', () => { invalidate(); updateControls(); });
  label.append(input, element('span', '', text));
  return { input, label };
}

function options(): CompareOptions {
  return { trimWhitespace: trim.input.checked, ignoreCase: ignoreCase.input.checked };
}

function createSource(side: 'before' | 'after', name: string, subtitle: string): SourceState {
  const panel = element('article', 'source-card');
  const top = element('div', 'source-card-top');
  const label = element('div', 'source-card-label');
  label.append(element('span', `source-dot source-dot-${side}`), element('h3', '', name), element('span', 'small muted', subtitle));
  top.append(label, element('span', 'source-card-index', side === 'before' ? 'A' : 'B'));
  const drop = element('div', 'drop-zone');
  const file = element('input', 'visually-hidden');
  file.type = 'file';
  file.id = `${side}-file`;
  file.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values';
  const choose = element('label', 'button button-outline', 'Choose file');
  choose.htmlFor = file.id;
  const title = element('p', 'source-filename', 'Drop a CSV or TSV here');
  const meta = element('p', 'small muted source-meta', 'or select one from your device');
  const icon = element('div', 'file-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  icon.append(element('span', '', 'CSV'), element('i'), element('i'), element('i'));
  drop.append(icon, title, meta, file, choose);
  const bottom = element('div', 'source-bottom');
  const delimiterLabel = element('label', 'delimiter-label small', 'Delimiter');
  delimiterLabel.htmlFor = `${side}-delimiter`;
  const delimiter = element('select', 'select select-small');
  delimiter.id = delimiterLabel.htmlFor;
  delimiter.append(selectOption('auto', 'Detect automatically'), selectOption(',', 'Comma ,'), selectOption('\t', 'Tab ⇥'), selectOption(';', 'Semicolon ;'), selectOption('|', 'Pipe |'));
  bottom.append(delimiterLabel, delimiter);
  const pasteDetails = element('details', 'paste-details');
  const summary = element('summary', 'small', 'Paste text instead');
  const pasteLabel = element('label', 'small', `${name} CSV or TSV text`);
  pasteLabel.htmlFor = `${side}-paste`;
  const paste = element('textarea', 'paste-area');
  paste.id = pasteLabel.htmlFor;
  paste.rows = 5;
  paste.spellcheck = false;
  paste.placeholder = 'customer_id,name,status\n001,Acme,active';
  const pasteButton = button('Use pasted text', 'button button-small button-outline', () => {
    demoGeneration += 1;
    void loadSource(state, { name: `${side}-pasted.csv`, text: paste.value, delimiter: delimiter.value as DelimiterChoice });
  });
  pasteDetails.append(summary, pasteLabel, paste, pasteButton);
  const message = element('p', 'source-message small');
  message.setAttribute('role', 'status');
  message.hidden = true;
  panel.append(top, drop, bottom, pasteDetails, message);
  const state: SourceState = { side, table: null, input: null, version: 0, loading: false, panel, title, meta, message, file, delimiter, paste, pasteButton };
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (selected) void loadFile(state, selected); });
  delimiter.addEventListener('change', () => {
    demoGeneration += 1;
    invalidate();
    if (state.input) void loadSource(state, { ...state.input, delimiter: delimiter.value as DelimiterChoice });
  });
  paste.addEventListener('input', () => {
    if (paste.value.length > MAX_BYTES) state.message.textContent = 'Pasted text is limited to 10 MiB.';
  });
  for (const name of ['dragenter', 'dragover']) {
    drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
  }
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    const files = event.dataTransfer?.files;
    if (files?.length === 1 && files[0]) void loadFile(state, files[0]);
    else if (files?.length) {
      invalidate();
      sourceError(state, 'Choose one file for this side.');
    }
  });
  return state;
}

async function loadFile(state: SourceState, file: File): Promise<void> {
  demoGeneration += 1;
  invalidate();
  state.version += 1;
  const version = state.version;
  state.table = null;
  state.input = null;
  state.title.textContent = file.name;
  updateControls();
  if (file.size > MAX_BYTES) { sourceError(state, 'This file exceeds the 10 MiB limit.'); return; }
  try {
    const bytes = await file.arrayBuffer();
    if (version !== state.version) return;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    await loadSource(state, { name: file.name, text, delimiter: state.delimiter.value as DelimiterChoice });
  } catch (error) {
    if (version !== state.version) return;
    sourceError(state, error instanceof TypeError ? 'This file is not valid UTF-8 text. Export it as UTF-8 CSV and try again.' : errorMessage(error));
  } finally { state.file.value = ''; }
}

async function loadSource(state: SourceState, source: SourceInput): Promise<void> {
  invalidate();
  state.version += 1;
  const version = state.version;
  state.input = source;
  state.table = null;
  state.title.textContent = source.name;
  state.title.title = source.name;
  state.delimiter.value = source.delimiter;
  if (new TextEncoder().encode(source.text).byteLength > MAX_BYTES) { sourceError(state, 'This text exceeds the 10 MiB limit.'); return; }
  state.loading = true;
  state.meta.textContent = 'Reading your records…';
  state.message.hidden = true;
  state.panel.classList.remove('has-error');
  state.panel.classList.add('is-loading');
  renderMappings();
  updateControls();
  try {
    const table = await parseSource(source);
    if (version !== state.version) return;
    state.table = table;
    state.meta.textContent = `${formatNumber(table.rowCount)} records · ${formatNumber(table.headers.length)} columns · ${delimiterName(table.delimiter)}`;
    state.panel.classList.add('has-file');
    if (table.skippedBlankLines) {
      state.message.textContent = `${formatNumber(table.skippedBlankLines)} empty line${table.skippedBlankLines === 1 ? '' : 's'} skipped.`;
      state.message.hidden = false;
    }
    reconcileMappings();
  } catch (error) {
    if (version === state.version) sourceError(state, errorMessage(error));
  } finally {
    if (version === state.version) {
      state.loading = false;
      state.panel.classList.remove('is-loading');
      renderMappings();
      updateControls();
    }
  }
}

function delimiterName(delimiter: string): string {
  return ({ ',': 'comma separated', ';': 'semicolon separated', '\t': 'tab separated', '|': 'pipe separated' } as Record<string, string>)[delimiter] ?? 'delimited text';
}

function sourceError(state: SourceState, message: string): void {
  state.loading = false;
  state.panel.classList.remove('is-loading');
  state.panel.classList.add('has-error');
  state.meta.textContent = 'Could not use this input';
  state.message.textContent = message;
  state.message.hidden = false;
  updateControls();
}

function reconcileMappings(): void {
  if (!before.table || !after.table) return;
  if (pendingRecipe) {
    mappings = pendingRecipe.mappings.map((mapping) => ({ ...mapping }));
    pendingRecipe = null;
    announce('Recipe loaded. Check the column pairs, then compare.');
    return;
  }
  if (mappings.length === 0) {
    mappings = suggestMappings(before.table, after.table);
    announce('Matching column names have been paired. Choose the key that identifies each record.');
  }
}

function renderMappings(): void {
  const ready = Boolean(before.table && after.table);
  mappingEmpty.hidden = ready;
  mappingGrid.hidden = !ready;
  mappingExplanation.hidden = !ready;
  addMappingButton.hidden = !ready;
  excluded.hidden = !ready;
  mappingGrid.replaceChildren();
  if (!before.table || !after.table) return;
  const labels = element('div', 'mapping-labels');
  labels.append(element('span', '', 'Before column'), element('span', '', ''), element('span', '', 'After column'), element('span', '', 'Use as'), element('span', 'visually-hidden', 'Remove'));
  mappingGrid.append(labels);
  for (const [index, mapping] of mappings.entries()) {
    const row = element('div', 'mapping-row');
    const beforeSelect = columnSelect(before.table.headers, mapping.before, `Before column for pair ${index + 1}`);
    const afterSelect = columnSelect(after.table.headers, mapping.after, `After column for pair ${index + 1}`);
    const role = element('select', 'select role-select');
    role.setAttribute('aria-label', `Role for column pair ${index + 1}`);
    role.append(selectOption('compare', 'Compare'), selectOption('key', 'Key'));
    role.value = mapping.role;
    role.classList.toggle('is-key', mapping.role === 'key');
    const remove = button('×', 'remove-mapping', () => { mappings.splice(index, 1); invalidate(); renderMappings(); updateControls(); });
    remove.setAttribute('aria-label', `Remove column pair ${index + 1}`);
    beforeSelect.addEventListener('change', () => { mapping.before = beforeSelect.value; invalidate(); renderExcluded(); updateControls(); });
    afterSelect.addEventListener('change', () => { mapping.after = afterSelect.value; invalidate(); renderExcluded(); updateControls(); });
    role.addEventListener('change', () => { mapping.role = role.value as ColumnMapping['role']; role.classList.toggle('is-key', mapping.role === 'key'); invalidate(); updateControls(); });
    row.append(beforeSelect, element('span', 'mapping-arrow', '→'), afterSelect, role, remove);
    mappingGrid.append(row);
  }
  renderExcluded();
}

function columnSelect(headers: string[], selected: string, label: string): HTMLSelectElement {
  const select = element('select', 'select column-select');
  select.setAttribute('aria-label', label);
  if (!headers.includes(selected)) select.append(selectOption(selected, `Missing: ${selected}`));
  for (const header of headers) select.append(selectOption(header, header));
  select.value = selected;
  select.classList.toggle('is-invalid', !headers.includes(selected));
  select.addEventListener('change', () => select.classList.toggle('is-invalid', !headers.includes(select.value)));
  return select;
}

function renderExcluded(): void {
  if (!before.table || !after.table) return;
  const excludedBefore = before.table.headers.filter((header) => !mappings.some((mapping) => mapping.before === header));
  const excludedAfter = after.table.headers.filter((header) => !mappings.some((mapping) => mapping.after === header));
  excluded.textContent = excludedBefore.length || excludedAfter.length
    ? `Excluded from comparison — Before: ${excludedBefore.join(', ') || 'none'}; After: ${excludedAfter.join(', ') || 'none'}. These values do not affect changed status.`
    : 'All columns are included.';
}

function addMapping(): void {
  if (!before.table || !after.table) return;
  const beforeColumn = before.table.headers.find((header) => !mappings.some((mapping) => mapping.before === header));
  const afterColumn = after.table.headers.find((header) => !mappings.some((mapping) => mapping.after === header));
  if (beforeColumn === undefined || afterColumn === undefined) { announce('Every column on one side is already paired. Remove a pair to change the mapping.'); return; }
  mappings.push({ before: beforeColumn, after: afterColumn, role: 'compare' });
  invalidate();
  renderMappings();
  updateControls();
}

function validMappings(): boolean {
  if (!before.table || !after.table || !mappings.some((mapping) => mapping.role === 'key')) return false;
  return mappings.every((mapping) => before.table?.headers.includes(mapping.before) && after.table?.headers.includes(mapping.after))
    && new Set(mappings.map((mapping) => mapping.before)).size === mappings.length
    && new Set(mappings.map((mapping) => mapping.after)).size === mappings.length;
}

function updateControls(): void {
  const loading = before.loading || after.loading || comparing;
  compareButton.disabled = !validMappings() || loading;
  compareButton.textContent = comparing ? 'Comparing…' : 'Compare files →';
  cancelButton.hidden = !loading;
  demoButton.disabled = loading;
  recipeButton.disabled = !validMappings();
  importButton.disabled = loading;
  before.pasteButton.disabled = before.loading;
  after.pasteButton.disabled = after.loading;
  compareButton.title = validMappings() ? '' : 'Load both files and choose at least one key. Each column may be paired once.';
  mappingValidation.hidden = !before.table || !after.table || validMappings();
  if (before.table && after.table && !validMappings()) {
    mappingValidation.textContent = !mappings.some((mapping) => mapping.role === 'key')
      ? 'Choose at least one Key to identify matching records.'
      : 'Each column must exist in its source file and may be paired only once. Check the column selections.';
  }
}

function announce(message: string, isError = false): void {
  notice.textContent = message;
  notice.classList.toggle('notice-error', isError);
  notice.hidden = false;
  notice.setAttribute('role', isError ? 'alert' : 'status');
}

function invalidate(): void {
  revision += 1;
  clearSampleGuide();
  if (comparison && !stale) { stale = true; renderResults(); }
}

function clearSampleGuide(): void {
  if (sampleComparison) notice.hidden = true;
  sampleComparison = null;
  resultBody.querySelector('.sample-guide')?.remove();
}

function scrollToResults(): void {
  resultsSection.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function compare(scroll = true): Promise<boolean> {
  clearSampleGuide();
  if (!before.table || !after.table || !validMappings()) { announce('Choose at least one key and use each column only once.', true); return false; }
  const currentRevision = revision;
  comparing = true;
  announce('Comparing records on your device…');
  updateControls();
  try {
    const result = await runComparison(before.table, after.table, mappings.map((mapping) => ({ ...mapping })), options());
    if (currentRevision !== revision) { announce('Your inputs changed while comparison was running. Compare again to refresh the results.'); return false; }
    comparison = result;
    stale = false;
    filter = 'all';
    query = '';
    page = 0;
    renderResults();
    announce(`Comparison complete. ${formatNumber(result.rows.length)} record groups reviewed.`);
    if (scroll) scrollToResults();
    return true;
  } catch (error) { if (currentRevision === revision) announce(errorMessage(error), true); return false; }
  finally { comparing = false; updateControls(); }
}

async function loadDemo(): Promise<void> {
  reset();
  const generation = demoGeneration;
  const beforeRevision = revision;
  await loadSource(before, demoBefore);
  if (generation !== demoGeneration || revision !== beforeRevision + 1) return;
  const afterRevision = revision;
  await loadSource(after, demoAfter);
  if (generation !== demoGeneration || revision !== afterRevision + 1) return;
  if (before.table && after.table) {
    mappings = demoMappings.map((mapping) => ({ ...mapping }));
    renderMappings();
    const sampleRevision = revision;
    const completed = await compare(false);
    if (completed && generation === demoGeneration && revision === sampleRevision) {
      sampleComparison = comparison;
      renderResults();
      announce('Synthetic sample complete. Explore exact changes, unchanged records, and keys that need review.');
      resultBody.querySelector<HTMLElement>('#sample-guide-heading')?.focus({ preventScroll: true });
      scrollToResults();
    }
  }
}

function cancel(): void {
  demoGeneration += 1;
  revision += 1;
  clearSampleGuide();
  cancelWork();
  for (const state of [before, after]) {
    state.version += 1;
    if (state.loading) sourceError(state, 'Reading cancelled. Choose the file again or use pasted text to retry.');
  }
  comparing = false;
  announce(comparison ? 'Work cancelled. Your existing results are still available below.' : 'Work cancelled. You can load your files again when ready.');
  updateControls();
}

function reset(): void {
  demoGeneration += 1;
  recipeGeneration += 1;
  window.clearTimeout(searchTimeout);
  cancelWork();
  revision += 1;
  clearSampleGuide();
  comparing = false;
  for (const state of [before, after]) {
    state.version += 1;
    state.table = null;
    state.input = null;
    state.loading = false;
    state.title.textContent = 'Drop a CSV or TSV here';
    state.title.removeAttribute('title');
    state.meta.textContent = 'or select one from your device';
    state.message.textContent = '';
    state.message.hidden = true;
    state.file.value = '';
    state.paste.value = '';
    state.delimiter.value = 'auto';
    state.panel.classList.remove('is-loading', 'has-file', 'has-error');
    const details = state.panel.querySelector('details');
    if (details) details.open = false;
  }
  mappings = [];
  pendingRecipe = null;
  comparison = null;
  stale = false;
  filter = 'all';
  query = '';
  page = 0;
  trim.input.checked = false;
  ignoreCase.input.checked = false;
  notice.hidden = true;
  importInput.value = '';
  renderMappings();
  renderResults();
  updateControls();
}

async function importRecipeFile(file: File): Promise<void> {
  recipeGeneration += 1;
  const generation = recipeGeneration;
  const currentRevision = revision;
  try {
    if (file.size > 256 * 1024) throw new Error('Recipe files must be smaller than 256 KiB.');
    const recipe = validateRecipe(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())) as unknown);
    if (currentRevision !== revision || generation !== recipeGeneration) return;
    invalidate();
    mappings = recipe.mappings;
    trim.input.checked = recipe.options.trimWhitespace;
    ignoreCase.input.checked = recipe.options.ignoreCase;
    pendingRecipe = before.table && after.table ? null : recipe;
    renderMappings();
    updateControls();
    announce(before.table && after.table ? 'Recipe loaded. Check the column pairs before comparing.' : 'Recipe loaded. Add both files to apply it.');
  } catch (error) {
    if (currentRevision === revision && generation === recipeGeneration) announce(`Could not load recipe: ${errorMessage(error)}`, true);
  } finally {
    if (generation === recipeGeneration) importInput.value = '';
  }
}

function renderResults(): void {
  window.clearTimeout(searchTimeout);
  resultBody.replaceChildren();
  if (!comparison) {
    const empty = element('div', 'results-empty');
    const illustration = element('div', 'empty-illustration');
    illustration.setAttribute('aria-hidden', 'true');
    illustration.append(element('span', 'empty-line'), element('span', 'empty-line'), element('span', 'empty-line'), element('span', 'empty-check', '✓'));
    const copy = element('div');
    copy.append(element('h3', '', 'Nothing slips between the rows.'), element('p', 'muted', 'Your comparison will appear here, with every change explained and uncertain matches called out.'));
    empty.append(illustration, copy);
    resultBody.append(empty);
    return;
  }
  const result = comparison;
  if (sampleComparison === result && !stale) resultBody.append(renderSampleGuide(result));
  if (stale) {
    const warning = element('div', 'stale-warning');
    warning.setAttribute('role', 'status');
    warning.append(element('strong', '', 'These results are from an earlier comparison.'), element('span', '', 'Your inputs or rules have changed. Compare again before exporting.'));
    resultBody.append(warning);
  }
  const overview = element('div', 'result-overview');
  const status = element('div', 'result-status');
  status.append(element('span', stale ? 'result-status-icon stale-icon' : 'result-status-icon', stale ? '↻' : '✓'), element('strong', '', stale ? 'Previous comparison' : 'Comparison complete'));
  const exports = element('div', 'export-controls');
  const exportChoices: [string, string, string, (value: Comparison) => string][] = [
    ['HTML report', 'text/html;charset=utf-8', 'row-witness-report.html', exportHtml],
    ['Changes CSV', 'text/csv;charset=utf-8', 'row-witness-changes.csv', exportCsv],
    ['Full JSON', 'application/json', 'row-witness-evidence.json', exportJson],
  ];
  for (const [label, mime, filename, format] of exportChoices) {
    const control = button(`↓ ${label}`, 'button button-small button-outline', () => {
      if (stale || !comparison) return;
      try { download(format(comparison), mime, filename); }
      catch (error) { announce(`Export failed: ${errorMessage(error)}`, true); }
    });
    control.disabled = stale;
    exports.append(control);
  }
  overview.append(status, exports);
  resultBody.append(overview);
  const summary = element('div', 'summary-grid');
  for (const kind of statusOrder) {
    const stat = button('', `stat-card stat-${kind}`, () => setFilter(kind));
    stat.append(element('span', 'stat-label', statusNames[kind]), element('strong', 'stat-value', formatNumber(result.counts[kind])));
    if (kind === 'conflict') stat.append(element('span', 'stat-footnote', 'ambiguous key groups'));
    else stat.append(element('span', 'stat-footnote', kind === 'unchanged' ? 'matched records' : 'record groups'));
    summary.append(stat);
  }
  resultBody.append(summary);
  const accounting = element('p', 'record-accounting small');
  accounting.append(element('strong', '', `${formatNumber(result.before.rowCount)} before records → ${formatNumber(result.after.rowCount)} after records.`));
  accounting.append(document.createTextNode(' Counts above are key groups; a review group may contain several records. Every source record is accounted for.'));
  resultBody.append(accounting);
  const toolbar = element('div', 'result-toolbar');
  const filters = element('div', 'filters');
  filters.setAttribute('aria-label', 'Filter comparison results');
  for (const kind of ['all', ...statusOrder] as const) {
    const control = button(kind === 'all' ? 'All records' : statusNames[kind], 'filter-button', () => setFilter(kind));
    control.dataset.filter = kind;
    control.setAttribute('aria-pressed', String(filter === kind));
    filters.append(control);
  }
  const searchLabel = element('label', 'search-label');
  searchLabel.append(element('span', 'visually-hidden', 'Search keys and values'));
  const search = element('input', 'search-input');
  search.type = 'search';
  search.placeholder = 'Search keys or values…';
  search.value = query;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => { query = search.value; page = 0; renderRows(tableArea, result); }, 120);
  });
  searchLabel.append(search);
  toolbar.append(filters, searchLabel);
  resultBody.append(toolbar);
  const tableArea = element('div', 'result-table-area');
  resultBody.append(tableArea);
  renderRows(tableArea, result);
  const details = element('details', 'evidence-details');
  details.append(element('summary', 'small', 'Comparison rules & file fingerprints'));
  const evidence = element('div', 'evidence-body');
  evidence.append(element('p', 'small', `Rules: ${result.options.trimWhitespace ? 'outer whitespace trimmed' : 'whitespace significant'}; ${result.options.ignoreCase ? 'letter case ignored' : 'case sensitive'}. Values remain text; no number or date conversion.`));
  evidence.append(element('p', 'small', `Excluded before columns: ${result.excludedBefore.join(', ') || 'none'}. Excluded after columns: ${result.excludedAfter.join(', ') || 'none'}.`));
  for (const source of [result.before, result.after]) {
    const fingerprint = element('div', 'fingerprint');
    fingerprint.append(element('strong', 'small', source.name), element('code', '', `SHA-256 ${source.sha256}`));
    evidence.append(fingerprint);
  }
  evidence.append(element('p', 'small muted', 'Reports include the original values, column mappings, rules, source line references, and file fingerprints. Changes CSV excludes unchanged groups. Recipes contain rules and mappings only.'));
  details.append(evidence);
  resultBody.append(details);
}

function renderSampleGuide(result: Comparison): HTMLElement {
  const guide = element('aside', 'sample-guide');
  guide.setAttribute('aria-labelledby', 'sample-guide-heading');
  const header = element('div', 'sample-guide-header');
  const heading = element('h3', '', 'Start here: a fictional customer list');
  heading.id = 'sample-guide-heading';
  heading.tabIndex = -1;
  const dismiss = button('Dismiss guide', 'button button-small button-quiet', () => {
    clearSampleGuide();
    const resultHeading = document.getElementById('results-heading');
    if (resultHeading) { resultHeading.tabIndex = -1; resultHeading.focus({ preventScroll: true }); }
  });
  header.append(heading, dismiss);
  guide.append(header, element('p', 'small', 'Synthetic sample. No customer data. Counts are key groups, not individual source rows.'));
  const steps = element('div', 'sample-guide-steps');
  const topics: [RowStatus, string, string, string][] = [
    ['changed', 'Spot the exact change', 'Juniper & Co. changed from Starter to Team, and 45.00 to 60.00. Expand its record to inspect the original values.', `See ${result.counts.changed} changed groups`],
    ['unchanged', 'Ignore the reshuffle', 'Northstar moved rows, but its selected values match. The last_seen column is excluded from this sample.', `See ${result.counts.unchanged} unchanged groups`],
    ['conflict', 'Keep uncertain matches visible', 'Duplicate ID 00113 keeps every original row. Blank IDs stay separate because they cannot reliably identify the same customer.', `Review ${result.counts.conflict} ambiguous groups`],
  ];
  for (const [kind, title, description, action] of topics) {
    const step = element('div', 'sample-guide-step');
    step.append(element('h4', '', title), element('p', 'small', description), button(action, 'button button-small button-outline', () => setFilter(kind)));
    steps.append(step);
  }
  guide.append(steps);
  return guide;
}

function setFilter(value: RowStatus | 'all'): void {
  filter = value;
  page = 0;
  for (const control of resultBody.querySelectorAll<HTMLButtonElement>('[data-filter]')) control.setAttribute('aria-pressed', String(control.dataset.filter === filter));
  const table = resultBody.querySelector<HTMLElement>('.result-table-area');
  if (table && comparison) renderRows(table, comparison);
}

function rowMatches(row: DiffRow, search: string): boolean {
  if (!search) return true;
  const includes = (value: string): boolean => value.toLocaleLowerCase().includes(search);
  return row.key.some(includes) || row.before.some((record) => record.values.some(includes))
    || row.after.some((record) => record.values.some(includes)) || includes(row.reason ?? '');
}

function renderRows(container: HTMLElement, result: Comparison): void {
  container.replaceChildren();
  const search = query.trim().toLocaleLowerCase();
  const rows = result.rows.filter((row) => (filter === 'all' || row.status === filter) && rowMatches(row, search));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, pageCount - 1);
  if (!rows.length) {
    container.append(element('p', 'no-results', 'No records match this view. Try another filter or search.'));
    return;
  }
  const scroll = element('div', 'table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Comparison records; scroll horizontally for more columns');
  const table = element('table', 'results-table');
  const caption = element('caption', 'visually-hidden', 'Compared record groups. Open a record to inspect every original value.');
  const head = element('thead');
  const headRow = element('tr');
  for (const label of ['Status', 'Record key', 'What changed', 'Source lines', 'Details']) {
    const cell = element('th', '', label);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element('tbody');
  for (const row of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const tr = element('tr', `record-row record-${row.status}`);
    const status = element('td');
    status.append(element('span', `status-badge status-${row.status}`, statusNames[row.status]));
    const key = element('td', 'record-key');
    const keyText = row.key.map((value) => value || '(blank)').join(' / ');
    const keyLabel = element('span', '', keyText);
    keyLabel.title = keyText;
    key.append(keyLabel);
    const labelColumn = result.mappings.find((mapping) => mapping.role === 'compare');
    if (labelColumn) {
      const label = row.after[0]?.values[result.after.headers.indexOf(labelColumn.after)] ?? row.before[0]?.values[result.before.headers.indexOf(labelColumn.before)];
      if (label !== undefined) key.append(element('span', 'record-subtitle', label));
    }
    const description = element('td', 'change-description');
    description.textContent = row.status === 'conflict'
      ? row.reason === 'blank-key' ? 'Blank key — cannot match safely' : 'Duplicate key — no winner chosen'
      : row.status === 'changed' ? row.changes.map((change) => change.beforeColumn === change.afterColumn ? change.beforeColumn : `${change.beforeColumn} → ${change.afterColumn}`).join(', ')
        : row.status === 'added' ? 'Only in the after file' : row.status === 'removed' ? 'Only in the before file' : 'All compared values match';
    const lines = element('td', 'source-lines');
    lines.append(element('span', '', `A: ${sourceLinePreview(row.before)}`), element('span', '', `B: ${sourceLinePreview(row.after)}`));
    const action = element('td');
    const detailsRow = element('tr', 'record-details-row');
    detailsRow.hidden = true;
    const detailsCell = element('td', 'record-details-cell');
    detailsCell.colSpan = 5;
    const inspect = button('Inspect +', 'inspect-button', () => {
      detailsRow.hidden = !detailsRow.hidden;
      inspect.textContent = detailsRow.hidden ? 'Inspect +' : 'Close −';
      inspect.setAttribute('aria-expanded', String(!detailsRow.hidden));
      if (!detailsRow.hidden && detailsCell.childElementCount === 0) fillRecordDetails(detailsCell, row, result);
    });
    inspect.setAttribute('aria-expanded', 'false');
    inspect.setAttribute('aria-label', `Inspect record ${keyText}`);
    action.append(inspect);
    tr.append(status, key, description, lines, action);
    detailsRow.append(detailsCell);
    body.append(tr, detailsRow);
  }
  table.append(caption, head, body);
  scroll.append(table);
  const pagination = element('div', 'pagination');
  const start = page * PAGE_SIZE + 1;
  pagination.append(element('span', 'small muted', `Showing ${formatNumber(start)}–${formatNumber(Math.min((page + 1) * PAGE_SIZE, rows.length))} of ${formatNumber(rows.length)} groups`));
  const pager = element('div', 'pager');
  const previous = button('← Previous', 'button button-small button-quiet', () => { page -= 1; renderRows(container, result); });
  const next = button('Next →', 'button button-small button-quiet', () => { page += 1; renderRows(container, result); });
  previous.disabled = page === 0;
  next.disabled = page >= pageCount - 1;
  pager.append(previous, element('span', 'small muted', `${page + 1} / ${pageCount}`), next);
  pagination.append(pager);
  container.append(scroll, pagination);
}

function sourceLinePreview(rows: SourceRow[]): string {
  if (!rows.length) return '—';
  return rows.slice(0, 3).map((record) => record.line).join(', ') + (rows.length > 3 ? ` (+${formatNumber(rows.length - 3)} more)` : '');
}

function fillRecordDetails(container: HTMLElement, row: DiffRow, result: Comparison): void {
  if (row.status === 'conflict') {
    const count = `${row.before.length} before record${row.before.length === 1 ? '' : 's'} and ${row.after.length} after record${row.after.length === 1 ? '' : 's'}`;
    container.append(element('p', 'review-explanation', row.reason === 'blank-key'
      ? `This group contains ${count}. At least one key part is blank. Add a reliable key in the source data before trying to match these records.`
      : `This group contains ${count}. The key occurs more than once on at least one side. All candidates are preserved; none has been selected as the correct match.`));
  }
  if (row.changes.length) {
    const changes = element('div', 'cell-changes');
    for (const change of row.changes) {
      const field = element('div', 'cell-change');
      field.append(element('strong', 'small', change.beforeColumn === change.afterColumn ? change.beforeColumn : `${change.beforeColumn} → ${change.afterColumn}`));
      const values = element('div', 'change-values');
      const old = element('div', 'old-value');
      old.append(element('span', 'value-label', 'BEFORE'), element('pre', '', change.before || '(empty)'));
      const updated = element('div', 'new-value');
      updated.append(element('span', 'value-label', 'AFTER'), element('pre', '', change.after || '(empty)'));
      values.append(old, updated);
      field.append(values);
      changes.append(field);
    }
    container.append(changes);
  }
  const originals = element('details', 'original-records');
  originals.open = row.status !== 'changed';
  originals.append(element('summary', 'small', 'All original values'));
  const grid = element('div', 'original-grid');
  grid.append(originalSide('Before', row.before, result.before.headers, result.mappings.map((mapping) => mapping.before)), originalSide('After', row.after, result.after.headers, result.mappings.map((mapping) => mapping.after)));
  originals.append(grid);
  container.append(originals);
}

function originalSide(label: string, rows: SourceRow[], headers: string[], included: string[]): HTMLElement {
  const side = element('div', 'original-side');
  side.append(element('h4', '', `${label} · ${rows.length} record${rows.length === 1 ? '' : 's'}`));
  if (!rows.length) side.append(element('p', 'small muted', 'No matching record on this side.'));
  const records = element('div');
  const pager = element('div', 'original-pager');
  let sourcePage = 0;
  const renderPage = (): void => {
    records.replaceChildren();
    pager.replaceChildren();
    for (const record of rows.slice(sourcePage * PAGE_SIZE, (sourcePage + 1) * PAGE_SIZE)) {
    const block = element('div', 'original-record');
    block.append(element('p', 'source-line-label small', `Source line ${record.line}`));
    const fields = element('dl', 'original-fields');
    for (const [index, header] of headers.entries()) {
      const name = element('dt', included.includes(header) ? '' : 'excluded-field', header);
      if (!included.includes(header)) name.append(element('span', 'field-note', ' · excluded'));
      const value = element('dd');
      value.append(element('pre', '', record.values[index] || '(empty)'));
      fields.append(name, value);
    }
    block.append(fields);
      records.append(block);
    }
    if (rows.length > PAGE_SIZE) {
      const previous = button('← Previous', 'button button-small button-outline', () => { sourcePage -= 1; renderPage(); });
      const next = button('Next →', 'button button-small button-outline', () => { sourcePage += 1; renderPage(); });
      previous.disabled = sourcePage === 0;
      next.disabled = (sourcePage + 1) * PAGE_SIZE >= rows.length;
      pager.append(element('p', 'small muted', `Records ${sourcePage * PAGE_SIZE + 1}–${Math.min((sourcePage + 1) * PAGE_SIZE, rows.length)} of ${formatNumber(rows.length)}. All records are included in reports.`), previous, next);
    }
  };
  renderPage();
  side.append(records, pager);
  return side;
}
