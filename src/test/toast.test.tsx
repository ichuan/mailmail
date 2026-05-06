import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../components/Toast';

function ToastHarness() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        for (let index = 0; index < 7; index += 1) {
          toast('info', `Message ${index}`, 1000);
        }
      }}
    >
      Add
    </button>
  );
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps only the newest five toasts and removes them when timers fire', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add'));

    expect(screen.queryByText('Message 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
    expect(screen.getByText('Message 2')).toBeInTheDocument();
    expect(screen.getByText('Message 6')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText('Message 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Message 6')).not.toBeInTheDocument();
  });
});