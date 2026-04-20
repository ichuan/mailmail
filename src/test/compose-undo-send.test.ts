import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleSend } from '../ComposeView';

describe('scheduleSend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT call sendFn before the delay elapses', () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    scheduleSend(sendFn, 1000);

    vi.advanceTimersByTime(999);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('calls sendFn exactly once after the delay', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    scheduleSend(sendFn, 1000);

    vi.advanceTimersByTime(1000);
    // Allow the async sendFn microtask to resolve.
    await Promise.resolve();

    expect(sendFn).toHaveBeenCalledOnce();
  });

  it('does NOT call sendFn when cancel() is called before delay', () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { cancel } = scheduleSend(sendFn, 1000);

    cancel();
    vi.advanceTimersByTime(1000);

    expect(sendFn).not.toHaveBeenCalled();
  });

  it('calling cancel() multiple times does not throw', () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { cancel } = scheduleSend(sendFn, 1000);

    expect(() => {
      cancel();
      cancel();
      cancel();
    }).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('late cancel() after delay fires has no effect (idempotent)', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const { cancel } = scheduleSend(sendFn, 1000);

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(sendFn).toHaveBeenCalledOnce();

    // Calling cancel after the send has already been dispatched must not throw.
    expect(() => cancel()).not.toThrow();
    // sendFn must still have been called only once.
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it('uses the custom delayMs provided', () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    scheduleSend(sendFn, 5000);

    vi.advanceTimersByTime(4999);
    expect(sendFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    // Timer fires; sendFn is enqueued as microtask — still not awaited yet.
    // Just verify the timer boundary is respected.
    expect(sendFn).toHaveBeenCalledTimes(1);
  });
});
