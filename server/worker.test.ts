import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorker } from './worker.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('Background notification processing', () => {
  it('generates overdue and clinical reminders without a browser request', async () => {
    vi.useFakeTimers();
    const samples = {
      refreshOverdueAlerts: vi.fn(),
      refreshClinicalReminders: vi.fn(),
    };
    const communications = {
      processPending: vi.fn().mockResolvedValue({ processed: 0 }),
    };
    const worker = startWorker(samples, communications);
    await vi.advanceTimersByTimeAsync(0);
    expect(samples.refreshOverdueAlerts).toHaveBeenCalledTimes(1);
    expect(samples.refreshClinicalReminders).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(samples.refreshClinicalReminders).toHaveBeenCalledTimes(2);
    expect(communications.processPending).toHaveBeenCalledTimes(13);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(communications.processPending).toHaveBeenCalledTimes(13);
  });

  it('does not overlap delivery batches and drains a running batch before shutdown', async () => {
    vi.useFakeTimers();
    let finish!: (value: { processed: number }) => void;
    const communications = {
      processPending: vi.fn(
        () =>
          new Promise<{ processed: number }>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const worker = startWorker(
      { refreshOverdueAlerts: vi.fn(), refreshClinicalReminders: vi.fn() },
      communications,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(communications.processPending).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = worker.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish({ processed: 1 });
    await stop;
    expect(stopped).toBe(true);
  });

  it('recovers on the next tick after a synchronous scan error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scan = vi.fn().mockImplementationOnce(() => {
      throw new Error('Database busy');
    });
    const processPending = vi.fn().mockResolvedValue({ processed: 0 });
    const worker = startWorker(
      { refreshOverdueAlerts: scan, refreshClinicalReminders: vi.fn() },
      { processPending },
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(processPending).toHaveBeenCalledTimes(1);
    await worker.stop();
  });
});
