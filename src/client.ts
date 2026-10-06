import type { ColumnMapping, CompareOptions, Comparison, SourceInput, Table, WorkerRequest, WorkerResponse } from './types';

declare const __WORKER_SOURCE__: string;
let serial = 0;
const active = new Map<number, { worker: Worker; reject: (reason: Error) => void }>();

export function cancelWork(): void {
  for (const task of active.values()) {
    task.worker.terminate();
    task.reject(new DOMException('Operation cancelled.', 'AbortError'));
  }
  active.clear();
}

function request(message: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject: (reason: Error) => void) => {
    if (active.size >= 4) {
      reject(new Error('Several files are still being processed. Wait for them to finish or cancel the current work.'));
      return;
    }
    const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch {
      URL.revokeObjectURL(url);
      reject(new Error('This browser blocked the local worker. Open the file in a current Chrome, Edge or Firefox browser.'));
      return;
    }
    URL.revokeObjectURL(url);
    active.set(message.id, { worker, reject });
    const finish = (): void => {
      worker.terminate();
      active.delete(message.id);
    };
    worker.onerror = (event): void => {
      event.preventDefault();
      finish();
      reject(new Error('The comparison worker stopped. Try a smaller file or reopen the app.'));
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      if (event.data.id !== message.id) return;
      finish();
      if (!event.data.ok) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    try {
      worker.postMessage(message);
    } catch {
      finish();
      reject(new Error('The browser could not copy these files into the worker. Try smaller exports.'));
    }
  });
}

export async function parseSource(source: SourceInput): Promise<Table> {
  const response = await request({ id: ++serial, action: 'parse', source });
  if (!response.ok || response.action !== 'parse') throw new Error('Unexpected parser response.');
  return response.table;
}

export async function runComparison(before: Table, after: Table, mappings: ColumnMapping[], options: CompareOptions): Promise<Comparison> {
  const response = await request({ id: ++serial, action: 'compare', before, after, mappings, options });
  if (!response.ok || response.action !== 'compare') throw new Error('Unexpected comparison response.');
  return response.comparison;
}
