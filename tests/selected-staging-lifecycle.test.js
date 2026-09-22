import { afterEach, expect, it, vi } from 'vitest';
import { createSelectedStagingLifecycle } from '../server/kernel/selected-staging-lifecycle.js';

afterEach(() => vi.useRealTimers());
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

it('coalesces startup, ingress and poll wakes and waits for active work before closing once', async () => {
  vi.useFakeTimers(); const first = deferred(), second = deferred();
  const wake = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const runtime = { wake, close: vi.fn(), store: {} };
  const lifecycle = createSelectedStagingLifecycle({ runtime, workerMode: 'embedded', pollIntervalMs: 1000 });
  expect(lifecycle.runtime.store).toBe(runtime.store);
  lifecycle.start(); lifecycle.start();
  const joined = lifecycle.runtime.wake();
  expect(lifecycle.runtime.wake()).toBe(joined);
  await vi.advanceTimersByTimeAsync(5000); expect(wake).toHaveBeenCalledTimes(1);
  first.resolve([]); await joined;
  await vi.advanceTimersByTimeAsync(1000); expect(wake).toHaveBeenCalledTimes(2);
  const closing = lifecycle.close(); expect(lifecycle.close()).toBe(closing);
  expect(runtime.close).not.toHaveBeenCalled();
  expect(await lifecycle.runtime.wake()).toEqual([]);
  second.resolve([]); await closing;
  expect(runtime.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000); expect(wake).toHaveBeenCalledTimes(2);
});
it('external mode keeps association capability but never consumes jobs on startup, ingress or poll', async () => {
  vi.useFakeTimers(); const pending = deferred();
  const runtime = { wake: vi.fn(), close: vi.fn(), sourceAssociation: { request: vi.fn(() => pending.promise) } };
  const lifecycle = createSelectedStagingLifecycle({ runtime, workerMode: 'external' });
  lifecycle.start(); await lifecycle.runtime.wake(); await vi.advanceTimersByTimeAsync(10000);
  expect(runtime.wake).not.toHaveBeenCalled();
  const active = lifecycle.runtime.sourceAssociation.request({ project_id: '42' });
  await Promise.resolve(); const closing = lifecycle.close();
  expect(runtime.close).not.toHaveBeenCalled();
  await expect(lifecycle.runtime.sourceAssociation.request({})).rejects.toMatchObject({ code: 'selected_staging_stopping' });
  pending.resolve({ ok: true }); await active; await closing;
  expect(runtime.close).toHaveBeenCalledTimes(1);
});
it('reports failures safely and resumes polling after synchronous and asynchronous errors', async () => {
  vi.useFakeTimers();
  const runtime = { wake: vi.fn().mockImplementationOnce(() => { throw new Error('secret'); })
    .mockRejectedValueOnce(Object.assign(new Error('secret'), { code: 'secret' })).mockResolvedValue([]), close: vi.fn() };
  const report = vi.fn();
  const lifecycle = createSelectedStagingLifecycle({ runtime, workerMode: 'embedded', pollIntervalMs: 1000, report });
  lifecycle.start(); await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.wake).toHaveBeenCalledTimes(3); expect(report).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(report.mock.calls)).not.toContain('secret');
  await lifecycle.close();
});
it('disabled lifecycle has no runtime and creates no timers', async () => {
  vi.useFakeTimers(); const lifecycle = createSelectedStagingLifecycle({ runtime: null, workerMode: 'disabled' });
  lifecycle.start(); expect(lifecycle.runtime).toBeNull(); expect(vi.getTimerCount()).toBe(0); await lifecycle.close();
});
