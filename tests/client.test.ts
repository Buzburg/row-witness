import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { cancelWork, parseSource } from '../src/client';
import type { Table, WorkerRequest, WorkerResponse } from '../src/types';

const originalWorker = globalThis.Worker;
const fakeGlobals = globalThis as typeof globalThis & { __WORKER_SOURCE__?: string };
class ControlledWorker {
  static instances: ControlledWorker[] = [];
  static failCopy = false;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  request: WorkerRequest | undefined;
  terminated = false;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(message: WorkerRequest): void {
    if (ControlledWorker.failCopy) throw new Error('Simulated allocation failure');
    this.request = message;
  }
  terminate(): void { this.terminated = true; }
  complete(table: Table): void {
    this.onmessage?.({ data: { id: this.request!.id, ok: true, action: 'parse', table } } as MessageEvent<WorkerResponse>);
  }
}
const source = { name: 'records.csv', text: 'id\n001', delimiter: ',' as const };
const table: Table = { name: source.name, headers: ['id'], rowCount: 1, rows: [{ line: 2, values: ['001'] }], delimiter: ',', skippedBlankLines: 0, sha256: 'test' };

beforeEach(() => {
  ControlledWorker.instances = [];
  ControlledWorker.failCopy = false;
  fakeGlobals.__WORKER_SOURCE__ = '';
  globalThis.Worker = ControlledWorker as unknown as typeof Worker;
});
afterEach(() => {
  cancelWork();
  globalThis.Worker = originalWorker;
  delete fakeGlobals.__WORKER_SOURCE__;
});

test('loading both file panels concurrently does not cancel either parser', async () => {
  const first = parseSource(source);
  const second = parseSource({ ...source, name: 'other.csv' });
  ControlledWorker.instances[1]!.complete({ ...table, name: 'other.csv' });
  ControlledWorker.instances[0]!.complete(table);
  assert.equal((await first).name, source.name);
  assert.equal((await second).name, 'other.csv');
  assert(ControlledWorker.instances.every(worker => worker.terminated));
});

test('cancel terminates every active worker, rejects pending work, and allows a fresh parse', async () => {
  const pending = [parseSource(source), parseSource(source)];
  const checked = pending.map(promise => assert.rejects(promise, { name: 'AbortError' }));
  cancelWork();
  await Promise.all(checked);
  assert(ControlledWorker.instances.every(worker => worker.terminated));
  const fresh = parseSource(source);
  ControlledWorker.instances[2]!.complete(table);
  assert.deepEqual(await fresh, table);
});

test('copy failure terminates the worker and does not consume a concurrency slot', async () => {
  ControlledWorker.failCopy = true;
  for (let count = 0; count < 5; count += 1) await assert.rejects(parseSource(source), /could not copy/);
  assert(ControlledWorker.instances.every(worker => worker.terminated));
  ControlledWorker.failCopy = false;
  const fresh = parseSource(source);
  ControlledWorker.instances.at(-1)!.complete(table);
  assert.deepEqual(await fresh, table);
});

test('rapid requests have a bounded worker count', async () => {
  const pending = Array.from({ length: 4 }, () => parseSource(source));
  const checked = pending.map(promise => assert.rejects(promise, { name: 'AbortError' }));
  await assert.rejects(parseSource(source), /still being processed/);
  assert.equal(ControlledWorker.instances.length, 4);
  cancelWork();
  await Promise.all(checked);
});

test('worker error releases resources and surfaces a useful message', async () => {
  const pending = parseSource(source);
  const checked = assert.rejects(pending, /worker stopped/);
  ControlledWorker.instances[0]!.onerror?.({ preventDefault() {} });
  await checked;
  assert.equal(ControlledWorker.instances[0]!.terminated, true);
});
