import { compareTables, parseTable } from './core';
import type { WorkerRequest, WorkerResponse } from './types';

globalThis.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const message = event.data;
  let response: WorkerResponse;
  try {
    if (message.action === 'parse') {
      const table = parseTable(message.source.text, message.source.name, message.source.delimiter);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message.source.text));
      table.sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      response = { id: message.id, ok: true, action: 'parse', table };
    } else {
      response = { id: message.id, ok: true, action: 'compare', comparison: compareTables(message.before, message.after, message.mappings, message.options) };
    }
  } catch (error) {
    response = { id: message.id, ok: false, error: error instanceof Error ? error.message : 'Unable to process these files.' };
  }
  globalThis.postMessage(response);
};
